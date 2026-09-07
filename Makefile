# Tracium — common tasks. Run `make help`.
.DEFAULT_GOAL := help
SPEC := spec/pricing/pricing.json
CHART_FILES := deploy/helm/tracium/files

help: ## List targets
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/' | sort

test: ## Run all unit tests (go + dashboard)
	cd collector && go test ./... ./processor/traciumprocessor/... ./exporter/clickhousespanexporter/...
	cd api && go test ./...
	cd dashboard && npm ci --no-audit && npm test

build-collector: ## Assemble the OSS collector binary via OCB (GOWORK off — OCB owns its module graph)
	cd collector && GOWORK=off go run go.opentelemetry.io/collector/cmd/builder@v0.116.0 --config builder/oss.builder.yaml

sync-generated: ## Copy the source-of-truth pricing + schema into the Helm chart's files/
	mkdir -p $(CHART_FILES)/pricing $(CHART_FILES)/schema
	cp $(SPEC) $(CHART_FILES)/pricing/pricing.json
	cp collector/schema/*.sql collector/schema/*.sh $(CHART_FILES)/schema/

up: ## Build + start the full stack from source (needs .env with JWT_SECRET)
	docker compose up --build

down: ## Stop the stack
	docker compose down

helm-lint: sync-generated ## Lint the Helm chart
	helm lint deploy/helm/tracium

smoke: ## Build and verify a fresh isolated stack (Docker + Python 3)
	bash deploy/tests/smoke.sh
