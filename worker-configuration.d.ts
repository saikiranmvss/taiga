interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TAIGA_API_URL: string;
  TAIGA_WEB_URL: string;
  TAIGA_AUTH_TYPE: string;
  APP_NAME: string;
  SESSION_SECRET: string;
}
