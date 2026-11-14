"""Gera os dados do site a partir dos resultados do projeto (pasta ../ml/ml).

Lê os benchmarks da Jetson (logs/jetson*/bench_all.csv) e as predições por
imagem (preds_*.csv) de cada rodada, calcula as fusões por track (HC, MV, MVCP)
e os ensembles, e grava:

    data/data.js         -> window.DATA = {...}  (lido pelo site; funciona com file://)
    data/execucoes.csv   -> tabela completa para download

Uso:
    python build_data.py                      # projeto em ../ml/ml
    python build_data.py --ml-dir CAMINHO     # outro local
"""

import argparse
import csv
import json
import sys
from datetime import date
from itertools import combinations
from pathlib import Path

ROUNDS = {
    "v1": {"dir": "logs/jetson", "label": "Rodada 1",
           "desc": "ventoinha automática (~95 °C, com throttling)"},
    "v2": {"dir": "logs/jetson_v2", "label": "Rodada 2",
           "desc": "refrigerada (ventoinha máxima, espera até 55 °C)"},
    "v3": {"dir": "logs/jetson_v3", "label": "Rodada 3",
           "desc": "refrigerada; TensorRT e PARSeq em duas resoluções"},
}
MODEL_NAMES = {"crnn": "CRNN", "svtr": "SVTR-Tiny", "parseq": "PARSeq-Tiny"}
TECH_NAMES = {"none": "Original", "fp16": "FP16", "trt_fp32": "TensorRT FP32",
              "trt_fp16": "TensorRT FP16"}
DECODE_NAMES = {"ar_r1": "AR", "nar_r0": "NAR", "nar_r1": "NAR+1", "ctc_greedy": ""}
N_LR = 5  # imagens LR por track no teste


def parse_run(run: str, round_key: str) -> dict:
    """Interpreta o nome do run (pasta do checkpoint) em modelo/entrada/resolução/poda."""
    parts = run.split("_")
    model = parts[1]
    binarize = "_bin" in run
    prune = 0
    for p in parts:
        if p.startswith("prune"):
            prune = int(p[5:])
    if model == "parseq":
        # Nas rodadas 1 e 2, "bj7_parseq" (e seus podados) ainda era o modelo 32x128;
        # a renomeação para "bj7_parseq_legado" veio antes da rodada 3.
        if "_legado" in run or (round_key in ("v1", "v2") and not binarize):
            res = "32x128"
        else:
            res = "64x256"
    else:
        res = "64x256"
    return {"model": model, "binarize": binarize, "prune": prune, "res": res}


def fnum(s, default=None):
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def fuse_track_metrics(preds_path: Path, fusion) -> dict:
    """Acurácia por track com HC, MV e MVCP (5 imagens LR) + acertos por track (para ensembles)."""
    by_track = fusion.load_preds_csv(preds_path)
    n = hc = mv = mvcp = 0
    for tid, d in by_track.items():
        lr = d["lr"]
        if not lr:
            continue
        n += 1
        gt = d["gt"]
        best = max(lr, key=lambda s: s[1])
        hc += best[0] == gt
        mv += fusion.weighted_vote(fusion._samples_to_seq_votes(lr))[0] == gt
        mvcp += fusion.weighted_vote_per_char(fusion._samples_to_char_votes(lr))[0] == gt
    return {"track_hc": hc / n, "track_mv": mv / n, "track_mvcp": mvcp / n, "n_tracks": n}


def ensemble_acc(paths: list, fusion) -> dict:
    """Fusão inter-modelos (mesmo algoritmo do fusion.py, só LR): MV e MVCP."""
    models = {str(i): fusion.load_preds_csv(p) for i, p in enumerate(paths)}
    common = set.intersection(*[set(m) for m in models.values()])
    res = {}
    for name, combiner in (("mv", fusion._combined_track_mv), ("mvcp", fusion._combined_track_mvcp)):
        ok = 0
        for tid in common:
            gt = models["0"][tid]["gt"]
            votes = [combiner(m[tid]) for m in models.values()]
            ok += fusion.weighted_vote(votes)[0] == gt
        res[name] = ok / len(common)
    res["n_tracks"] = len(common)
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ml-dir", type=Path, default=Path(__file__).resolve().parent.parent / "ml" / "ml")
    args = ap.parse_args()
    ml = args.ml_dir.resolve()
    sys.path.insert(0, str(ml))
    import fusion  # noqa: E402  (fusion.py do projeto)

    out_dir = Path(__file__).resolve().parent / "data"
    out_dir.mkdir(exist_ok=True)

    runs = []
    preds_index = {}  # (round, run, compress, decode) -> caminho do preds
    for rk, rinfo in ROUNDS.items():
        bench = ml / rinfo["dir"] / "bench_all.csv"
        for r in csv.DictReader(open(bench, encoding="utf-8")):
            run = Path(r["ckpt"].replace("\\", "/")).parent.name
            info = parse_run(run, rk)
            preds = ml / rinfo["dir"] / Path(r["preds_csv"].replace("\\", "/")).name
            n_img = int(r["n_images"])
            energy_wh = fnum(r["energy_wh"])
            fps = fnum(r["fps"])
            row = {
                "round": rk,
                "run": run,
                "model": info["model"],
                "model_name": MODEL_NAMES[info["model"]],
                "input": "binarizada" if info["binarize"] else "cor",
                "res": info["res"].replace("x", "×"),
                "technique": "Pruning {}%".format(info["prune"]) if info["prune"] else TECH_NAMES[r["compress"]],
                "compress": r["compress"],
                "prune": info["prune"],
                "decode": DECODE_NAMES.get(r["decode_mode"], r["decode_mode"]),
                "acc_img": fnum(r["seq_acc"]) * 100,
                "acc_char": fnum(r["char_acc"]) * 100,
                "fps": fps,
                "latency_ms": fnum(r["avg_latency_ms"]),
                "plates_s": fps / N_LR,
                "mem_mb": fnum(r["peak_gpu_mem_mb"]),
                "size_mb": fnum(r["model_size_mb"]),
                "size_gz_mb": fnum(r["model_size_gz_mb"]),
                "temp_avg": fnum(r["avg_temp_c"]),
                "temp_max": fnum(r["max_temp_c"]),
                "power_w": fnum(r["avg_power_w"]),
                "energy_j_img": energy_wh * 3600 / n_img if energy_wh is not None else None,
                "n_images": n_img,
            }
            if preds.exists():
                row.update({k: (v * 100 if k.startswith("track_") else v)
                            for k, v in fuse_track_metrics(preds, fusion).items()})
                preds_index[(rk, run, r["compress"], row["decode"])] = preds
            runs.append(row)
            print("{} {:<24} {:<14} {:<6} img={:5.2f} track={}".format(
                rk, run, row["technique"], row["decode"], row["acc_img"],
                "{:5.2f}".format(row["track_mvcp"]) if "track_mvcp" in row else "-"))

    def find(rk, run, compress, decode=""):
        for r in runs:
            if (r["round"], r["run"], r["compress"], r["decode"]) == (rk, run, compress, decode):
                return r
        raise KeyError((rk, run, compress, decode))

    # Grupos de ensemble: membros candidatos; todo subconjunto de 2 ou 3 vira uma linha.
    groups = [
        ("Cor, PyTorch FP32, PARSeq NAR+1", [("v2", "bj7_crnn", "none", ""), ("v2", "bj7_svtr", "none", ""), ("v2", "bj7_parseq", "none", "NAR+1")]),
        ("Cor, PyTorch FP32, PARSeq AR", [("v2", "bj7_crnn", "none", ""), ("v2", "bj7_svtr", "none", ""), ("v2", "bj7_parseq", "none", "AR")]),
        ("Cor, FP16, PARSeq NAR+1", [("v2", "bj7_crnn", "fp16", ""), ("v2", "bj7_svtr", "fp16", ""), ("v2", "bj7_parseq", "fp16", "NAR+1")]),
        ("Cor, TensorRT FP16 (PARSeq em PyTorch)", [("v3", "bj7_crnn", "trt_fp16", ""), ("v3", "bj7_svtr", "trt_fp16", ""), ("v3", "bj7_parseq_legado", "none", "NAR+1")]),
        ("Cor, melhor de cada (CRNN PyTorch, SVTR TensorRT, PARSeq NAR+1)", [("v2", "bj7_crnn", "none", ""), ("v3", "bj7_svtr", "trt_fp16", ""), ("v2", "bj7_parseq", "none", "NAR+1")]),
        ("Binarizada, PyTorch FP32, PARSeq NAR+1", [("v2", "bj7_crnn_bin", "none", ""), ("v2", "bj7_svtr_bin", "none", ""), ("v2", "bj7_parseq_bin", "none", "NAR+1")]),
    ]
    ensembles, seen = [], set()
    for gname, members in groups:
        rows = [find(*m) for m in members]
        for k in (2, 3):
            for combo in combinations(range(len(rows)), k):
                sel = [rows[i] for i in combo]
                label = " + ".join(
                    r["model_name"].split("-")[0]
                    + (" " + r["decode"] if r["decode"] else "")
                    + (" TRT" if r["compress"].startswith("trt") else "")
                    + (" FP16" if r["compress"] == "fp16" else "")
                    for r in sel)
                # A mesma combinação pode surgir em dois grupos (ex.: PARSeq da rodada 2 e
                # da rodada 3, que é o mesmo modelo): fica a primeira.
                if (label, sel[0]["input"]) in seen:
                    continue
                seen.add((label, sel[0]["input"]))
                acc = ensemble_acc([preds_index[(r["round"], r["run"], r["compress"], r["decode"])] for r in sel], fusion)
                lat = sum(r["latency_ms"] for r in sel)
                ensembles.append({
                    "group": gname,
                    "members": label,
                    "n_models": k,
                    "input": sel[0]["input"],
                    "track_mv": acc["mv"] * 100,
                    "track_mvcp": acc["mvcp"] * 100,
                    "latency_ms": lat,
                    "fps": 1000 / lat,
                    "plates_s": 1000 / lat / N_LR,
                    "energy_j_img": sum(r["energy_j_img"] for r in sel),
                    "size_mb": sum(r["size_mb"] for r in sel),
                })
                print("ens {:<60} mvcp={:5.2f} placas/s={:4.2f}".format(label, acc["mvcp"] * 100, 1000 / lat / N_LR))

    # Desktop: acurácia por imagem e ensemble AR com as predições do treino (mesmos pesos).
    desk = {}
    for key, run in (("crnn", "bj7_crnn"), ("svtr", "bj7_svtr"), ("parseq", "bj7_parseq_legado")):
        p = ml / "logs" / run / "{}_preds.csv".format(run)
        rows = [r for r in csv.DictReader(open(p, encoding="utf-8")) if r["image_type"] == "lr"]
        desk[key] = {"acc_img": 100 * sum(r["gt"] == r["pred"] for r in rows) / len(rows),
                     "track_mvcp": fuse_track_metrics(p, fusion)["track_mvcp"] * 100}
    desk["ensemble_ar"] = ensemble_acc(
        [ml / "logs" / r / "{}_preds.csv".format(r) for r in ("bj7_crnn", "bj7_svtr", "bj7_parseq_legado")], fusion)["mvcp"] * 100

    data = {
        "generated": date.today().isoformat(),
        "rounds": ROUNDS,
        "runs": runs,
        "ensembles": ensembles,
        "desktop": desk,
        "links": {
            "repo": "https://github.com/PedroLeite3005/tcc-placa-ocr",
            "article": "artigo.pdf",
        },
    }
    (out_dir / "data.js").write_text(
        "// Gerado por build_data.py — não editar à mão.\nwindow.DATA = "
        + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")

    cols = ["round", "run", "model_name", "input", "res", "technique", "decode", "acc_img", "acc_char",
            "track_hc", "track_mv", "track_mvcp", "fps", "latency_ms", "plates_s", "mem_mb", "size_mb",
            "size_gz_mb", "temp_avg", "temp_max", "power_w", "energy_j_img", "n_images"]
    with open(out_dir / "execucoes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in runs:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
    print("\n{} execuções, {} ensembles -> {}".format(len(runs), len(ensembles), out_dir))


if __name__ == "__main__":
    main()
