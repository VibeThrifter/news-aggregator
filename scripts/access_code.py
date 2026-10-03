#!/usr/bin/env python3
"""Access codes for "Zoek met AI" (Epic 14, Story 14.10; migration 009).

A code unlocks options in the app on the device where it is entered (/admin → Toegangscode). Only
the sha256 of a code is stored; the code itself is printed once, here. For now only role "admin"
may search and approve (voice_search_role_allowed in migration 009); "pro" is ready for paying
users.

Usage (from the repo root):
  PYTHONPATH=. .venv/bin/python scripts/access_code.py create --role admin --label Eigenaar
  PYTHONPATH=. .venv/bin/python scripts/access_code.py list
  PYTHONPATH=. .venv/bin/python scripts/access_code.py revoke --id 3
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import secrets
import sys

from sqlalchemy import text

from backend.app.db.session import get_sessionmaker


def new_code(role: str) -> str:
    return f"pf-{role}-{secrets.token_urlsafe(18)}"


def code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


async def create(role: str, label: str | None, limit: int) -> None:
    code = new_code(role)
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                text(
                    "INSERT INTO access_codes (code_hash, role, label, daily_search_limit) "
                    "VALUES (:hash, :role, :label, :limit) RETURNING id"
                ),
                {"hash": code_hash(code), "role": role, "label": label, "limit": limit},
            )
        ).one()
        await session.commit()
    print(f"Code {row.id} ({role}{', ' + label if label else ''}), zichtbaar alleen nu:")
    print(f"  {code}")
    print("Vul hem in op /admin → Toegangscode, op het apparaat waar je hem gebruikt.")


async def list_codes() -> None:
    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT c.id, c.role, c.label, c.daily_search_limit, c.created_at, "
                    "c.last_used_at, c.revoked_at, "
                    "(SELECT count(*) FROM voice_searches s WHERE s.requested_by = c.id) "
                    "AS searches "
                    "FROM access_codes c ORDER BY c.id"
                )
            )
        ).all()
    if not rows:
        print("Nog geen codes.")
    for row in rows:
        state = f"ingetrokken {row.revoked_at:%Y-%m-%d}" if row.revoked_at else "actief"
        used = (
            f"laatst gebruikt {row.last_used_at:%Y-%m-%d %H:%M}"
            if row.last_used_at
            else "nog niet gebruikt"
        )
        limit = f"{row.searches} zoektochten, max {row.daily_search_limit}/dag"
        print(f"{row.id:>3}  {row.role:<5}  {row.label or '-':<24}  {state:<22} {used}  {limit}")


async def revoke(code_id: int) -> None:
    async with get_sessionmaker()() as session:
        result = await session.execute(
            text(
                "UPDATE access_codes SET revoked_at = now() WHERE id = :id AND revoked_at IS NULL"
            ),
            {"id": code_id},
        )
        await session.commit()
    print("Ingetrokken." if result.rowcount else "Geen actieve code met dat nummer.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("create", help="maak een nieuwe code")
    make.add_argument("--role", choices=["admin", "pro"], default="admin")
    make.add_argument("--label", default=None)
    make.add_argument("--limit", type=int, default=30, help="zoektochten per dag")
    sub.add_parser("list", help="toon alle codes")
    drop = sub.add_parser("revoke", help="trek een code in")
    drop.add_argument("--id", type=int, required=True)
    args = parser.parse_args()
    if args.command == "create":
        asyncio.run(create(args.role, args.label, args.limit))
    elif args.command == "list":
        asyncio.run(list_codes())
    else:
        asyncio.run(revoke(args.id))


if __name__ == "__main__":
    sys.exit(main())
