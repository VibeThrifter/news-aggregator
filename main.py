from __future__ import annotations

import argparse
import sys

from src.pipeline import run_aggregation


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cluster nieuws-perspectieven rond een gebeurtenis.")
    parser.add_argument("query", nargs="+", help="Gebeurtenis of zoekterm om te aggregeren")
    parser.add_argument(
        "--mode",
        choices=["algorithm", "medium"],
        default="algorithm",
        help="Kies clustering via KMeans of groepeer op mediumtype",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args(sys.argv[1:])
    query = " ".join(args.query)
    clusters = run_aggregation(query, mode=args.mode)
    if not clusters:
        print("Geen resultaten gevonden.")
        return 0
    for cluster in clusters:
        print(f"{cluster.label} [{cluster.method}]: {cluster.description}")
        print(f"  Politieke mix: {cluster.political_mix}")
        for article in cluster.sources:
            print(f"    - {article.source_name}: {article.title} ({article.url})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
