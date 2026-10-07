from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from echo import __version__
from echo.api import auth, claims, episodes, retrieval

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Here we would initialize connections if they were async,
    # or spawn the worker thread if it runs in the same process.
    # Currently the worker is intended to run as a separate process.
    yield


app = FastAPI(
    title="ECHO — Your Digital Twin API",
    description="Memory backend for personal digital twin.",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For demo purposes
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(claims.router)
app.include_router(episodes.router)
app.include_router(retrieval.router)

@app.get("/health", tags=["health"])
def health_check():
    from echo.core.config import get_settings
    return {
        "status": "ok", 
        "version": __version__,
        "mode": get_settings().provider_mode
    }
