# syntax=docker/dockerfile:1.7
#
# One image: the React build is bundled into the Spring Boot jar and served by
# it, so the app is a single container next to PostgreSQL.
#
#   docker build -t boot-inspection .
#   docker compose up        (app + PostgreSQL, see compose.yaml)

# ---- 1. front end ---------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. API jar with the front end inside ----------------------------------
FROM eclipse-temurin:21-jdk-noble AS api
WORKDIR /api
COPY api/gradlew api/settings.gradle.kts api/build.gradle.kts ./
COPY api/gradle gradle
COPY api/src src
COPY --from=web /web/dist /web-dist
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon --quiet bootJar -PwebDist=/web-dist
# Split the jar into layers: dependencies change rarely, so pushing a new
# version of the app only re-sends the small application layer.
RUN java -Djarmode=tools -jar build/libs/boot-inspection.jar extract --layers --destination /extracted

# ---- 3. runtime -------------------------------------------------------------
FROM eclipse-temurin:21-jre-noble
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=api /extracted/dependencies/ ./
COPY --from=api /extracted/spring-boot-loader/ ./
COPY --from=api /extracted/snapshot-dependencies/ ./
COPY --from=api /extracted/application/ ./
USER app
EXPOSE 8080
# Size the heap from the container's memory limit, not the host's.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "boot-inspection.jar"]
