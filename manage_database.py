"""Initialize, inspect, import or export Fiable Postgres without logging secrets."""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys

from database import COLLECTIONS, DatabaseUnavailable, PostgresStore


def load_source(directory):
    directory = directory.resolve(strict=True)
    documents, proofs = {}, []
    for name in COLLECTIONS:
        path = directory / f"{name}.json"
        if not path.is_file():
            continue
        if not path.resolve().is_relative_to(directory):
            raise ValueError("A source file points outside the supplied data directory.")
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            raise ValueError(f"{path.name} could not be read as valid JSON. Nothing was imported.") from None
        PostgresStore.records(name, value)
        documents[name] = value
    # Check routing before connecting, preserving all dispatcher edits.
    if "batch_routing" in documents:
        import server
        documents["batch_routing"] = server.validate_batch_routing(documents["batch_routing"])
    proof_root = directory / "proof"
    if proof_root.is_dir():
        for path in sorted(proof_root.iterdir()):
            if not path.is_file():
                continue
            if not path.resolve().is_relative_to(directory):
                raise ValueError("A proof file points outside the supplied data directory.")
            mime = mimetypes.guess_type(path.name)[0]
            if mime not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("The proof directory includes an unsupported file type.")
            proofs.append((path.name, path.read_bytes(), mime))
    names = {proof[0] for proof in proofs}
    for delivery in documents.get("deliveries", []):
        for field in ("photoPath", "signaturePath"):
            filename = (delivery.get("proofOfDelivery") or {}).get(field)
            if filename and filename not in names:
                raise ValueError("A delivery references a missing proof file. Restore the file before importing.")
    manifest_path = directory / "manifest.json"
    if manifest_path.exists():
        if not manifest_path.resolve().is_relative_to(directory):
            raise ValueError("The backup manifest points outside the supplied directory.")
        try:
            checksums = json.loads(manifest_path.read_text(encoding="utf-8"))["sha256"]
        except (OSError, ValueError, KeyError, TypeError):
            raise ValueError("The backup manifest is invalid.") from None
        expected = {f"{name}.json" for name in documents} | {f"proof/{name}" for name in names}
        if not isinstance(checksums, dict) or set(checksums) != expected:
            raise ValueError("The backup files do not match the manifest.")
        for name, checksum in checksums.items():
            path = (directory / name).resolve()
            if not path.is_relative_to(directory) or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
                raise ValueError("A backup checksum did not match. Nothing was imported.")
    return documents, proofs


def import_source(store, documents, proofs):
    """All collections and proof bytes commit together; never overwrite a target."""
    store.initialize()
    with store.transaction() as connection:
        if connection.execute("SELECT 1 FROM fiable.collections LIMIT 1").fetchone():
            raise ValueError("The target database already contains app data. Import requires an empty target database.")
        if connection.execute("SELECT 1 FROM fiable.proof_files LIMIT 1").fetchone():
            raise ValueError("The target database already contains uploads. Import requires an empty target database.")
        for name, value in documents.items():
            store.write(f"{name}.json", value)
            if store.read(f"{name}.json") != value:
                raise ValueError("Imported records did not match the source; the transaction was rolled back.")
        for filename, data, mime in proofs:
            store.write_blob(filename, data, mime)
            if store.read_blob(filename) != (data, mime):
                raise ValueError("An imported proof did not match the source; the transaction was rolled back.")


def export_snapshot(store, destination):
    destination = destination.resolve()
    if destination.exists():
        raise ValueError("Choose a new export directory; existing directories are never overwritten.")
    documents, proofs = {}, []
    with store.transaction() as connection:
        for name in COLLECTIONS:
            if store.exists(f"{name}.json"):
                documents[name] = store.read(f"{name}.json")
        for filename, data, mime in connection.execute(
            "SELECT filename, content, mime_type FROM fiable.proof_files ORDER BY filename"
        ).fetchall():
            if Path(filename).name != filename:
                raise ValueError("A stored proof filename is invalid; export was stopped.")
            proofs.append((filename, bytes(data), mime))
    destination.mkdir(parents=True, mode=0o700)
    checksums = {}
    for name, value in documents.items():
        payload = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
        path = destination / f"{name}.json"
        path.write_bytes(payload)
        checksums[path.name] = hashlib.sha256(payload).hexdigest()
    if proofs:
        (destination / "proof").mkdir(mode=0o700)
    for filename, data, _ in proofs:
        path = destination / "proof" / filename
        path.write_bytes(data)
        checksums[f"proof/{filename}"] = hashlib.sha256(data).hexdigest()
    (destination / "manifest.json").write_text(json.dumps({"sha256": checksums}, indent=2), encoding="utf-8")
    return len(documents), len(proofs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Create the additive database schema.")
    commands.add_parser("check", help="Print collection counts without customer details.")
    importing = commands.add_parser("import-json", help="Validate a JSON backup; use --apply to import into an empty database.")
    importing.add_argument("--source", type=Path, required=True)
    importing.add_argument("--apply", action="store_true", help="Actually write the validated data to an empty target.")
    exporting = commands.add_parser("export-json", help="Create a consistent JSON and proof-file backup.")
    exporting.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "import-json":
            documents, proofs = load_source(args.source)
            for name, value in documents.items():
                print(f"{name}: {len(value) if isinstance(value, list) else 1} document(s)")
            print(f"Proof files: {len(proofs)}")
            if not args.apply:
                print("Validation passed. No database connection or data changes were made. Add --apply to import.")
                return 0
        url = os.environ.get("DATABASE_URL", "").strip()
        if not url:
            raise ValueError("Set DATABASE_URL in your terminal environment first. Do not pass it on the command line.")
        store = PostgresStore(url)
        if args.command == "init":
            store.initialize()
            print("PostgreSQL schema ready.")
        elif args.command == "import-json":
            import_source(store, documents, proofs)
            print("Import committed and verified. Source files were left unchanged.")
        elif args.command == "export-json":
            documents_count, proofs_count = export_snapshot(store, args.destination)
            print(f"Export complete: {documents_count} collections and {proofs_count} proof files.")
        elif args.command == "check":
            from psycopg import sql
            with store.transaction() as connection:
                versions = connection.execute("SELECT version FROM fiable.schema_migrations ORDER BY version").fetchall()
                print("Schema versions:", ", ".join(str(row[0]) for row in versions))
                for name in COLLECTIONS:
                    count = connection.execute(sql.SQL("SELECT count(*) FROM fiable.{}").format(sql.Identifier(name))).fetchone()[0]
                    print(f"{name}: {count}")
                print("proof_files:", connection.execute("SELECT count(*) FROM fiable.proof_files").fetchone()[0])
        return 0
    except (ValueError, DatabaseUnavailable, OSError) as error:
        print(f"Database task stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
