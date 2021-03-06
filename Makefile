wsl:
	@sudo curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.2/install.sh | bash \
	&& export NVM_DIR="$$HOME/.nvm" \
	&& [ -s "$$NVM_DIR/nvm.sh" ] \
	&& \. "$$NVM_DIR/nvm.sh" \
	&& nvm install node \
	&& nvm install-latest-npm \
	&& rm -rf node_modules \
	&& npm install \
	&& npx tsc \
	&& chmod +x ./lib/index.js
	@sudo apt install chromium-browser -y
	@echo "Please restart your shell before running ./lib/index.js"
mac:
	@brew install node && brew install npm
	@rm -rf node_modules && npm install && npx tsc && chmod +x ./lib/index.js