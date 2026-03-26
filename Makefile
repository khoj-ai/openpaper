COMPOSE ?= docker compose
COMPOSE_FILES = -f docker-compose.yml -f docker-compose.local.yml

.PHONY: compose-config compose-up compose-down compose-logs compose-ps

compose-config:
	$(COMPOSE) $(COMPOSE_FILES) config

compose-up:
	$(COMPOSE) $(COMPOSE_FILES) up --build -d

compose-down:
	$(COMPOSE) $(COMPOSE_FILES) down

compose-logs:
	$(COMPOSE) $(COMPOSE_FILES) logs -f --tail=200

compose-ps:
	$(COMPOSE) $(COMPOSE_FILES) ps
