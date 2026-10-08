"""Operator-only account toggle: python -m app.premium USERNAME on|off."""

import argparse

from sqlalchemy import select, update

from app.models.db import Account, Session, init_db
from app.services.auth import username_key


def set_premium(username: str, enabled: bool) -> str:
    init_db()
    with Session.begin() as db:
        account = db.scalar(select(Account).where(Account.username_key == username_key(username)))
        if account is None:
            raise ValueError(f"Account not found: {username}")
        account.premium = enabled
        return account.username


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username", nargs="?")
    parser.add_argument("--all-existing", action="store_true", help="Apply to all current accounts")
    parser.add_argument("status", choices=("on", "off"))
    args = parser.parse_args()
    if bool(args.username) == args.all_existing:
        parser.error("Specify a username or --all-existing.")
    if args.all_existing:
        init_db()
        with Session.begin() as db:
            count = db.execute(update(Account).values(premium=args.status == "on")).rowcount
        print(f"{count} existing accounts: premium {args.status}")
        return
    try:
        name = set_premium(args.username, args.status == "on")
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    print(f"{name}: premium {args.status}")


if __name__ == "__main__":
    main()
