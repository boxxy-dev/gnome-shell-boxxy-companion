# Boxxy Terminal — GNOME Shell Extension
# Targets: install, uninstall, pack, enable, disable

UUID       := boxxy@boxxy.dev
EXT_DIR    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_DIR    := extension
BUILD_DIR  := build/$(UUID)

# All files that ship with the extension
SRC_FILES  := $(SRC_DIR)/extension.js \
              $(SRC_DIR)/prefs.js \
              $(SRC_DIR)/metadata.json \
              $(SRC_DIR)/stylesheet.css
RES_DIR    := $(SRC_DIR)/resources
SCHEMA_DIR := $(SRC_DIR)/schemas

.PHONY: build install uninstall clean pack enable disable debug

## build    — Stage files into build/ ready for install
build: $(BUILD_DIR)
	@for f in $(SRC_FILES); do \
		dest="$(BUILD_DIR)/$$(basename $$f)"; \
		[ -f "$$f" ] && (cmp -s "$$f" "$$dest" 2>/dev/null || cp "$$f" "$$dest"); \
	done
	@mkdir -p "$(BUILD_DIR)/resources"
	@cp -r "$(RES_DIR)/"* "$(BUILD_DIR)/resources/" 2>/dev/null || true
	@mkdir -p "$(BUILD_DIR)/schemas"
	@cp "$(SCHEMA_DIR)/"*.xml "$(BUILD_DIR)/schemas/"
	@glib-compile-schemas "$(BUILD_DIR)/schemas/"
	@echo "[OK] Build staged in $(BUILD_DIR)/"

$(BUILD_DIR):
	@mkdir -p "$(BUILD_DIR)"

## install  — Build and install to user extensions directory
install: build
	@mkdir -p "$(EXT_DIR)"
	@cp -r "$(BUILD_DIR)/"* "$(EXT_DIR)/"
	@echo "[OK] Extension installed to $(EXT_DIR)/"
	@echo "      Restart GNOME Shell (Alt+F2, r) or run: make enable"

## uninstall — Remove the extension from user directory
uninstall:
	@rm -rf "$(EXT_DIR)"
	@echo "[OK] Extension uninstalled from $(EXT_DIR)/"

## clean    — Remove build artifacts
clean:
	@rm -rf build/
	@echo "[OK] Build artifacts cleaned."

## pack     — Create a distributable .zip bundle
pack: build
	@cd build && zip -r ../$(UUID).zip $(UUID)/
	@echo "[OK] Packaged as $(UUID).zip"

## enable   — Enable the extension via gnome-extensions
enable:
	@gnome-extensions enable $(UUID) 2>/dev/null || \
		echo "Could not enable $(UUID).  Restart Shell and try again."

## disable  — Disable the extension via gnome-extensions
disable:
	@gnome-extensions disable $(UUID) 2>/dev/null || true

## debug    — Tail Shell journal
debug:
	@journalctl -f -o cat /usr/bin/gnome-shell

## help     — Show this help
help:
	@grep -E '^##' Makefile | sed 's/^##[ ]*//'
