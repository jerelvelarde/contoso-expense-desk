# syntax=docker/dockerfile:1
#
# Live mode backend: the Microsoft Agent Framework expense agent behind the
# CopilotKit .NET runtime (agent/ExpenseDesk). Build context is the REPO ROOT
# so seed/ and cards/ go into the image:
#
#   docker build -f deploy/agent.Dockerfile -t expense-desk-agent .
#   docker run --rm -p 4640:8080 --env-file agent.env expense-desk-agent
#
# Model and Intelligence secrets are runtime env vars on THIS service only
# (Railway service variables / --env-file). Never bake them into the image and
# never give them to the web service. See deploy/README.md.

ARG DOTNET_VERSION=10.0

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS build
# The ASP.NET Core host project. Change this if agent/ is restructured.
ARG AGENT_PROJECT=agent/ExpenseDesk/ExpenseDesk.csproj
WORKDIR /src
COPY agent/ agent/
RUN dotnet restore "$AGENT_PROJECT"
RUN dotnet publish "$AGENT_PROJECT" -c Release -o /app --no-restore -p:UseAppHost=false


FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION}
WORKDIR /app
COPY --from=build /app ./
COPY seed/ ./seed/
COPY cards/ ./cards/

# PORT is set by Railway. Kestrel listens on it on all interfaces (IPv4 and
# IPv6, so <service>.railway.internal reaches it). Forwarded headers are on
# because Railway's edge terminates TLS.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    DESK_SEED_DIR=/app/seed \
    PORT=8080 \
    AGENT_DLL=ExpenseDesk.dll
USER $APP_UID
EXPOSE 8080
# The CopilotKit runtime reaches the agent over HTTP inside this same process
# (DESK_AGENT_URL). Its built-in default is port 5000, so point it at PORT
# unless it is set explicitly.
ENTRYPOINT ["/bin/sh", "-c", "export ASPNETCORE_HTTP_PORTS=\"${PORT:-8080}\"; export DESK_AGENT_URL=\"${DESK_AGENT_URL:-http://127.0.0.1:${PORT:-8080}/agents/expense}\"; exec dotnet \"/app/${AGENT_DLL}\""]
