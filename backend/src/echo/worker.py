import logging
from echo.core.db import session_scope
from echo.jobs.worker import start_worker_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

if __name__ == "__main__":
    start_worker_loop()
