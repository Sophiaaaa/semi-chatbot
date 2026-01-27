# MySQL Setup Guide

## Configuration
The application uses the MySQL connection settings from `.env`.
- **Database Name**: `DB_NAME` (default: `ServiceDX`, created automatically if missing)
- **Tables**: `dws_tas_roster`, `dws_wisdom_machine` (created and seeded automatically if empty)

## Connection Settings
Configure the following keys in `.env`:
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

If you encounter an "Access denied" error, it usually means the username/password in `.env` is incorrect, or the user does not have permissions for the target database/table.
```

## Data Simulation
The system automatically checks if tables are empty. If so, it inserts:
- 100 mock records into `dws_tas_roster`
