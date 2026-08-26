const config = {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{ts,tsx,css,md,json,mjs}": ["prettier --write"],
};

export default config;
