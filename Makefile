.DEFAULT_GOAL := help

.PHONY: help install install-node install-browser build check-build audit test check test-unit test-browser test-browser-ui

help: ## Показать доступные команды
	@awk 'BEGIN {FS = ":.*## "; printf "Tiqui Quiz\n\nИспользование:\n  make <цель>\n\nЦели:\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: install-node install-browser ## Установить все зависимости для разработки

install-node: ## Установить npm-пакеты
	npm ci

install-browser: ## Установить Chromium для Playwright
	npm run test:install-browser

build: ## Собрать автономный quiz.html из src/
	npm run build

check-build: ## Проверить актуальность собранного quiz.html
	npm run check:build

audit: ## Проверить npm-зависимости на известные уязвимости
	npm audit --audit-level=high

test: ## Запустить все тесты
	npm test

check: test ## Синоним полного запуска тестов

test-unit: ## Запустить модульные тесты
	npm run test:unit

test-browser: ## Запустить браузерные тесты
	npm run test:browser

test-browser-ui: ## Открыть интерактивный интерфейс Playwright
	npm run test:browser:ui
