FROM python:3.12-slim-bookworm

WORKDIR /app

RUN pip install uv

# Dependencies come from uv.lock rather than from pyproject.toml. The ranges
# there are floors with no ceilings, so resolving at build time meant every
# image picked up whatever had been published that day, and a release from any
# dependency could break production with no change on our side. Upgrades are
# now a deliberate `uv lock --upgrade`, reviewed and committed like any other
# change. --frozen fails the build if the lock has drifted from pyproject.toml.
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-emit-project -o requirements.txt \
    && uv pip install --system -r requirements.txt

# App code is copied after the install so editing it doesn't rebuild the
# dependency layer.
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
COPY shell.py ./
COPY gunicorn.config.py ./

CMD ["gunicorn", "-c", "gunicorn.config.py", "app.main:app"]
