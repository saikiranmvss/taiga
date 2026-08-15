export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  full_name_display: string;
  email: string;
  color?: string;
  roles?: string[];
  photo?: string | null;
}

export interface SessionData {
  token: string;
  refresh?: string;
  user: SessionUser;
  exp: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    session: SessionData;
  };
};
