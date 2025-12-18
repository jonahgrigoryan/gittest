# syntax=docker/dockerfile:1.7
FROM rust:1.82-bullseye AS builder
ARG GIT_SHA="dev"
# Install protobuf-compiler required for tonic-build
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler && rm -rf /var/lib/apt/lists/*
# Copy proto directory to root level (build.rs expects ../../proto from services/solver/)
COPY proto/ /proto/
WORKDIR /app
# Copy solver source code
COPY services/solver/ ./
RUN cargo build --release

FROM debian:bullseye-slim AS runtime
ARG GIT_SHA="dev"
ARG BUILD_TS="unknown"
RUN apt-get update && apt-get install -y --no-install-recommends libssl1.1 ca-certificates netcat-openbsd && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/solver /usr/local/bin/poker-solver
ENV SOLVER_PORT=50051
ENV SOLVER_ADDR=0.0.0.0:50051
ENV SOLVER_CACHE_PATH=/cache
EXPOSE 50051
VOLUME ["/cache"]
CMD ["/usr/local/bin/poker-solver"]
LABEL org.opencontainers.image.source="https://github.com/jonahgrigoryan/gittest" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_TS"
