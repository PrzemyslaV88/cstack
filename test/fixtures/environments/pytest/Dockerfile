FROM python:3.12.12-slim-bookworm
COPY requirements.lock /opt/cstack-requirements.lock
RUN python -m pip install --require-hashes --only-binary=:all: -r /opt/cstack-requirements.lock
