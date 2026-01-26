# MySQL Setup Guide

## Configuration
The application is now configured to use a local MySQL database.
- **Database Name**: `ServiceDX` (Created automatically)
- **Tables**: `dws_tas_roster`, `dws_wisdom_machine` (Created and seeded automatically)

## Connection Settings
By default, the application attempts to connect with:
- Host: `127.0.0.1`
- User: `root`
- Password: `root`

## Troubleshooting "Access Denied"
If you encounter an "Access denied" error (which is currently happening), it means your local MySQL password for `root` is not `root`.

You can override the password using an environment variable:

```bash
# Mac/Linux
export DB_PASSWORD=your_actual_password
npm start
```

Or on Windows (PowerShell):
```powershell
$env:DB_PASSWORD="your_actual_password"
npm start
```

## Data Simulation
The system automatically checks if tables are empty. If so, it inserts:
- 100 mock records into `dws_tas_roster`
- 50 mock records into `dws_wisdom_machine`
