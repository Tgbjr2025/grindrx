#!/usr/bin/env python3
"""FXBot entrypoint: python run.py [--config config.yaml] [--once]"""

import argparse
import asyncio

from fxbot.config import load_config
from fxbot.engine import Engine
from fxbot.log import setup_logging


def main() -> None:
    parser = argparse.ArgumentParser(description="FXBot - autonomous forex trading bot")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--once", action="store_true", help="run a single cycle and exit (smoke test)")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    log = setup_logging(args.log_level)
    cfg = load_config(args.config)

    if cfg.mode == "live":
        log.warning("=" * 60)
        log.warning("LIVE MODE - REAL MONEY WILL BE TRADED")
        log.warning("=" * 60)

    engine = Engine(cfg)

    async def once() -> None:
        await engine.broker.connect()
        await engine.run_cycle()

    try:
        asyncio.run(once() if args.once else engine.run_forever())
    except KeyboardInterrupt:
        log.info("stopped by user")


if __name__ == "__main__":
    main()
