# Yandex Cloud backend

Python 3.12 Cloud Function + YDB Serverless. Deploy index.py and requirements.txt as a ZIP; entrypoint is index.handler. Create the users table using schema.sql. Attach a service account with access to the database. Configure FRONTEND_ORIGIN, YDB_ENDPOINT, YDB_DATABASE, and BOT_TOKEN in the function settings. Never commit the token.

A public function is required for the Mini App. Telegram initData is verified server-side. Public requests consume quota even if rejected. Cloud Functions and YDB can incur charges outside free limits; monitor usage. A successful GET checks configuration presence only, not database connectivity. Existing Cloudflare records do not automatically migrate. This code does not implement payments or VPN provisioning.
