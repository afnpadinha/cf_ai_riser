#!/bin/sh
set -e

echo "Applying schema..."
npx wrangler d1 execute riser-db --local --file=schema.sql

echo "Seeding database..."
npx wrangler d1 execute riser-db --local --file=seed.sql

echo "Starting dev server..."
exec npx vite dev --host