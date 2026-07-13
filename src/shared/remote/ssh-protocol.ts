export type RemoteSSHProfileSummary = {
  profileId: string;
  name: string;
  host: string;
  port: number;
  user: string;
  defaultRemoteCwd: string | null;
  remoteCommand: string | null;
};

export type SSHProfileListResult = {
  profiles: RemoteSSHProfileSummary[];
};
