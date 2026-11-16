# Boxxy Terminal — GNOME Shell Extension
# Targets: build, install, uninstall, clean, pack, enable, disable, debug

UUID       := boxxy@boxxy.dev
EXT_DIR    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_DIR    := extension
BUILD_DIR  := build/$(UUID)
SCHEMA_DIR := $(SRC_DIR)/schemas

.PHONY: build install uninstall clean pack enable disable debug help

## build    — Stage files into build/ ready for install
build:
	@rm -rf "$(BUILD_DIR)"
	@mkdir -p "$(BUILD_DIR)"
	@cp -r "$(SRC_DIR)/"* "$(BUILD_DIR)/"
	@glib-compile-schemas "$(BUILD_DIR)/schemas/"
	@echo "[OK] Build staged in $(BUILD_DIR)/"

## install  — Build and install to user extensions directory
install: build
	@rm -rf "$(EXT_DIR)"
	@mkdir -p "$(EXT_DIR)"
	@cp -r "$(BUILD_DIR)/"* "$(EXT_DIR)/"
	@echo "[OK] Extension installed to $(EXT_DIR)/"
	@echo "      Restart GNOME Shell (log out/in on Wayland) or run: make enable"

## uninstall — Remove the extension from user directory
uninstall:
	@rm -rf "$(EXT_DIR)"
	@echo "[OK] Extension uninstalled from $(EXT_DIR)/"

## clean    — Remove build artifacts
clean:
	@rm -rf build/ "$(UUID).zip"
	@echo "[OK] Build artifacts cleaned."

## pack     — Create a distributable .zip bundle
pack: build
	@rm -f "$(UUID).zip"
	@cd build && zip -qr "../$(UUID).zip" "$(UUID)/"
	@echo "[OK] Packaged as $(UUID).zip"

## enable   — Enable the extension via gnome-extensions
enable:
	@gnome-extensions enable $(UUID) 2>/dev/null || \
		echo "Could not enable $(UUID). Restart Shell and try again."

## disable  — Disable the extension via gnome-extensions
disable:
	@gnome-extensions disable $(UUID) 2>/dev/null || true

## debug    — Tail Shell journal
debug:
	@journalctl -f -o cat /usr/bin/gnome-shell

## help     — Show this help
help:
	@grep -E '^##' Makefile | sed 's/^##[ ]*//'
