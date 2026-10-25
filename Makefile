# macOS build & release. CI runs the same npm scripts, so a local build and a
# released build differ only in signing credentials.
SHELL := /bin/sh

NPM ?= npm
PRODUCT := Pi Desktop
# Current package.json version; `make release VERSION=…` is what changes it.
CURRENT_VERSION := $(shell node -p "require('./package.json').version")
# Host architecture by default: arm64 on Apple Silicon, x64 on Intel.
ARCH ?= $(shell node -p "process.arch")
DIST := dist
# electron-builder's macOS layout: arm64 builds land in dist/mac-arm64, x64 in
# dist/mac. The suffix keeps the paths below free of make conditionals.
ARCH_DIR_SUFFIX := $(shell [ "$(ARCH)" = "arm64" ] && echo -arm64)
APP_DIR := $(DIST)/mac$(ARCH_DIR_SUFFIX)
APP := $(APP_DIR)/$(PRODUCT).app
DMG := $(DIST)/Pi-Desktop-$(CURRENT_VERSION)-$(ARCH).dmg

.DEFAULT_GOAL := help
.PHONY: help check-darwin install dev demo test icon app run dmg dist \
	release publish clean distclean

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

check-darwin:
	@[ "$$(uname -s)" = "Darwin" ] || { echo "error: macOS only"; exit 1; }

install: ## Install dependencies (npm ci)
	$(NPM) ci

dev: ## Run from source with hot reload (electron-vite dev)
	$(NPM) run dev

demo: ## Build and run against the bundled offline demo
	$(NPM) run build && $(NPM) run demo

test: ## Typecheck and run the test suite (real pi sessions, no API key needed)
	$(NPM) run typecheck
	$(NPM) test

icon: ## Regenerate build/icon.png and build/icon.icns
	node scripts/make-icon.mjs

app: check-darwin ## Build a runnable .app (ad-hoc signed, fastest iteration)
	$(NPM) run pack:mac -- --$(ARCH)
	@codesign --verify --strict "$(APP)" && echo "→ $(APP)"

run: app ## Build, sign and launch the app
	open "$(APP)"

dmg: check-darwin ## Build a dmg for the host architecture
	$(NPM) run dist:mac -- --$(ARCH)
	@ls -lh "$(DMG)"

dist: check-darwin ## Build dmgs for both arm64 and x64
	$(NPM) run dist:mac -- --arm64 --x64
	@ls -lh $(DIST)/Pi-Desktop-*.dmg

release: check-darwin ## Bump version, commit, tag and push (CI publishes)
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=0.2.0"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "error: worktree is dirty"; exit 1; }
	$(NPM) version $(VERSION) -m "chore(release): v%s"
	git push --follow-tags
	@echo "v$(VERSION) pushed — GitHub Actions builds and publishes the dmg"

publish: check-darwin ## Build locally and upload to GitHub Releases (GH_TOKEN)
	@test -n "$$GH_TOKEN" || { echo "error: GH_TOKEN is not set"; exit 1; }
	$(NPM) run publish:mac -- --$(ARCH)
	@echo "→ $(DMG)"

clean: ## Remove build output
	rm -rf $(DIST)

distclean: clean ## Remove build output and node_modules
	rm -rf node_modules
