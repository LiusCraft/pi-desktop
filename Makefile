# macOS build & release (win-* targets cover Windows). CI runs the same npm scripts, so a local build and a
# released build differ only in signing credentials.
# Windows: leave SHELL alone, make uses sh when it is on PATH (Git Bash) and cmd.exe otherwise,
# so every recipe and $(shell) below sticks to node / npm instead of POSIX tools.
ifneq ($(OS),Windows_NT)
SHELL := /bin/sh
endif

NPM ?= npm
PRODUCT := Pi Desktop
# Current package.json version (local builds only; CI sets it from the release tag).
CURRENT_VERSION := $(shell node -p "require('./package.json').version")
# Host architecture by default: arm64 on Apple Silicon, x64 on Intel.
ARCH ?= $(shell node -p "process.arch")
DIST := dist
# electron-builder's macOS layout: arm64 builds land in dist/mac-arm64, x64 in
# dist/mac. The suffix keeps the paths below free of make conditionals.
ARCH_DIR_SUFFIX := $(if $(filter arm64,$(ARCH)),-arm64)
APP_DIR := $(DIST)/mac$(ARCH_DIR_SUFFIX)
APP := $(APP_DIR)/$(PRODUCT).app
DMG := $(DIST)/Pi-Desktop-$(CURRENT_VERSION)-$(ARCH).dmg

.DEFAULT_GOAL := help
.PHONY: help check-darwin install dev demo test icon app run dmg dist \
	release publish cask clean distclean

help: ## Show this help
	@node scripts/make-help.mjs $(MAKEFILE_LIST)

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

cask: ## Print the Homebrew cask for the dmgs in dist/ (CI pushes the same file to the tap)
	@node scripts/cask.mjs --version="$(CURRENT_VERSION)" --dist="$(DIST)"

win-app: ## Build an unpacked Windows app (dist/win-unpacked)
	$(NPM) run pack:win
	@echo Built $(DIST)/win-unpacked/$(PRODUCT).exe

win-installer: ## Build the Windows NSIS installer (x64)
	$(NPM) run dist:win
	@echo Built $(DIST)/Pi-Desktop-$(CURRENT_VERSION)-win-x64-setup.exe

release: ## Tag HEAD and push; CI publishes (bumps the latest tag by BUMP=patch, or VERSION=x.y.z)
	@node scripts/release.mjs --version="$(VERSION)" --bump="$(BUMP)" --force="$(FORCE)" --dry-run="$(DRY_RUN)"

publish: check-darwin ## Build locally and upload to GitHub Releases (GH_TOKEN)
	@test -n "$$GH_TOKEN" || { echo "error: GH_TOKEN is not set"; exit 1; }
	$(NPM) run publish:mac -- --$(ARCH)
	@echo "→ $(DMG)"

clean: ## Remove build output
	rm -rf $(DIST)

distclean: clean ## Remove build output and node_modules
	rm -rf node_modules
