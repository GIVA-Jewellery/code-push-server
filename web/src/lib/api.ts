interface CodePushAPI {
  baseURL: string;
  token?: string;
}

class CodePushAPIClient {
  private baseURL: string;
  private token?: string;

  constructor(baseURL: string = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.token = this.getStoredToken();
  }

  private getStoredToken(): string | undefined {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('codepush_token') || undefined;
    }
    return undefined;
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('codepush_token', token);
    }
  }

  clearToken() {
    this.token = undefined;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('codepush_token');
    }
  }

  private async fetch(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    return response;
  }

  // Authentication
  async checkAuth(): Promise<{ authenticated: boolean }> {
    const response = await this.fetch('/authenticated');
    return response.json();
  }

  getLoginURL(): string {
    return `${this.baseURL}/auth/login`;
  }

  getRegisterURL(): string {
    return `${this.baseURL}/auth/register`;
  }

  // Apps
  async getApps(): Promise<{ apps: App[] }> {
    const response = await this.fetch('/apps');
    return response.json();
  }

  async createApp(name: string): Promise<{ app: App }> {
    const response = await this.fetch('/apps', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return response.json();
  }

  async getApp(appName: string): Promise<App> {
    const response = await this.fetch(`/apps/${appName}`);
    return response.json();
  }

  async deleteApp(appName: string): Promise<void> {
    await this.fetch(`/apps/${appName}`, {
      method: 'DELETE',
    });
  }

  // Deployments
  async getDeployments(appName: string): Promise<{ deployments: Deployment[] }> {
    const response = await this.fetch(`/apps/${appName}/deployments`);
    return response.json();
  }

  async createDeployment(appName: string, deploymentName: string): Promise<{ deployment: Deployment }> {
    const response = await this.fetch(`/apps/${appName}/deployments`, {
      method: 'POST',
      body: JSON.stringify({ name: deploymentName }),
    });
    return response.json();
  }

  async deleteDeployment(appName: string, deploymentName: string): Promise<void> {
    await this.fetch(`/apps/${appName}/deployments/${deploymentName}`, {
      method: 'DELETE',
    });
  }

  // Releases
  async getDeploymentHistory(appName: string, deploymentName: string): Promise<{ history: Package[] }> {
    const response = await this.fetch(`/apps/${appName}/deployments/${deploymentName}/history`);
    return response.json();
  }

  async promoteRelease(appName: string, sourceDeployment: string, targetDeployment: string, options?: {
    rollout?: number;
    description?: string;
    disabled?: boolean;
    mandatory?: boolean;
  }): Promise<void> {
    await this.fetch(`/apps/${appName}/deployments/${targetDeployment}/promote/${sourceDeployment}`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async rollbackRelease(appName: string, deploymentName: string, targetRelease?: string): Promise<void> {
    const endpoint = targetRelease 
      ? `/apps/${appName}/deployments/${deploymentName}/rollback/${targetRelease}`
      : `/apps/${appName}/deployments/${deploymentName}/rollback`;
    
    await this.fetch(endpoint, {
      method: 'POST',
    });
  }
}

export interface App {
  name: string;
  collaborators: Record<string, { permission: string }>;
  deployments: string[];
}

export interface Deployment {
  name: string;
  key: string;
  package?: Package;
}

export interface Package {
  appVersion: string;
  description: string;
  label: string;
  packageHash: string;
  blobUrl: string;
  size: number;
  uploadTime: number;
  isDisabled: boolean;
  isMandatory: boolean;
  rollout?: number;
  releasedBy?: string;
  releaseMethod?: string;
}

// Create singleton instance
export const api = new CodePushAPIClient();
export default api;