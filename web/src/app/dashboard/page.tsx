'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/auth-guard';
import api, { App } from '@/lib/api';

export default function DashboardPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    try {
      setIsLoading(true);
      const result = await api.getApps();
      setApps(result.apps || []);
    } catch (error) {
      setError('Failed to load apps');
      console.error('Error loading apps:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) {
      setError('App name is required');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      await api.createApp(newAppName.trim());
      setNewAppName('');
      setShowCreateForm(false);
      await loadApps();
    } catch (error) {
      setError('Failed to create app');
      console.error('Error creating app:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteApp = async (appName: string) => {
    if (!confirm(`Are you sure you want to delete the app "${appName}"?`)) {
      return;
    }

    try {
      await api.deleteApp(appName);
      await loadApps();
    } catch (error) {
      setError('Failed to delete app');
      console.error('Error deleting app:', error);
    }
  };

  const handleLogout = () => {
    api.clearToken();
    router.push('/login');
  };

  const getOwnerEmail = (collaborators: Record<string, { permission: string }>) => {
    for (const [email, collab] of Object.entries(collaborators)) {
      if (collab.permission === 'Owner') {
        return email;
      }
    }
    return 'Unknown';
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">CodePush Dashboard</h1>
                <p className="mt-1 text-sm text-gray-500">Manage your mobile app deployments</p>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          {/* Apps section */}
          <div className="px-4 py-6 sm:px-0">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-900">Your Apps</h2>
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create App
              </button>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-600">{error}</p>
              </div>
            )}

            {/* Create app form */}
            {showCreateForm && (
              <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg shadow">
                <form onSubmit={handleCreateApp} className="space-y-4">
                  <div>
                    <label htmlFor="appName" className="block text-sm font-medium text-gray-700">
                      App Name
                    </label>
                    <input
                      id="appName"
                      type="text"
                      value={newAppName}
                      onChange={(e) => setNewAppName(e.target.value)}
                      placeholder="Enter app name"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div className="flex space-x-3">
                    <button
                      type="submit"
                      disabled={isCreating}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                    >
                      {isCreating ? 'Creating...' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateForm(false);
                        setNewAppName('');
                        setError('');
                      }}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Apps list */}
            {isLoading ? (
              <div className="flex justify-center items-center h-48">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              </div>
            ) : apps.length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 48 48">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M34 40h10v-4a6 6 0 00-10.712-3.714M34 40H14m20 0v-4a9.971 9.971 0 00-.712-3.714M14 40H4v-4a6 6 0 0110.712-3.714M14 40v-4a9.971 9.971 0 01.712-3.714M34 40H14m0 0v-4a9.971 9.971 0 01.712-3.714" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No apps</h3>
                <p className="mt-1 text-sm text-gray-500">Get started by creating your first app.</p>
                <div className="mt-6">
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create App
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {apps.filter(app => app && app.name).map((app) => (
                  <div key={app.name} className="bg-white overflow-hidden shadow rounded-lg">
                    <div className="p-6">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <div className="h-8 w-8 bg-indigo-500 rounded-full flex items-center justify-center">
                            <span className="text-sm font-medium text-white">
                              {app.name?.charAt(0)?.toUpperCase() || '?'}
                            </span>
                          </div>
                        </div>
                        <div className="ml-4 flex-1">
                          <h3 className="text-lg font-medium text-gray-900 truncate">{app.name || 'Unnamed App'}</h3>
                          <p className="text-sm text-gray-500">Owner: {getOwnerEmail(app.collaborators || {})}</p>
                        </div>
                      </div>
                      
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-sm text-gray-500">
                          <span>Deployments: {app.deployments?.length || 0}</span>
                          <span>Collaborators: {Object.keys(app.collaborators || {}).length}</span>
                        </div>
                      </div>

                      <div className="mt-6 flex space-x-3">
                        <button
                          onClick={() => app.name && router.push(`/apps/${encodeURIComponent(app.name)}`)}
                          disabled={!app.name}
                          className="flex-1 bg-indigo-50 text-indigo-700 px-3 py-2 text-sm font-medium rounded-md hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Manage
                        </button>
                        <button
                          onClick={() => app.name && handleDeleteApp(app.name)}
                          disabled={!app.name}
                          className="bg-red-50 text-red-700 px-3 py-2 text-sm font-medium rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}