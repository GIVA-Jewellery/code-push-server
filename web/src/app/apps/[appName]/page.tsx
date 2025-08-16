'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/auth-guard';
import api, { App, Deployment, Package } from '@/lib/api';

interface AppPageProps {
  params: Promise<{
    appName: string;
  }>;
}

export default function AppPage({ params }: AppPageProps) {
  const [app, setApp] = useState<App | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [deploymentHistory, setDeploymentHistory] = useState<Package[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const [showCreateDeployment, setShowCreateDeployment] = useState(false);
  const [newDeploymentName, setNewDeploymentName] = useState('');
  const [isCreatingDeployment, setIsCreatingDeployment] = useState(false);
  const router = useRouter();

  const resolvedParams = use(params);
  const appName = decodeURIComponent(resolvedParams.appName);

  useEffect(() => {
    loadAppData();
  }, [appName]);

  useEffect(() => {
    if (selectedDeployment) {
      loadDeploymentHistory(selectedDeployment);
    }
  }, [selectedDeployment]);

  const loadAppData = async () => {
    try {
      setIsLoading(true);
      const [appResult, deploymentsResult] = await Promise.all([
        api.getApp(appName).catch(() => null),
        api.getDeployments(appName).catch(() => ({ deployments: [] }))
      ]);
      
      setApp(appResult);
      setDeployments(deploymentsResult.deployments || []);
      
      if (deploymentsResult.deployments?.length > 0) {
        setSelectedDeployment(deploymentsResult.deployments[0].name);
      }
    } catch (error) {
      setError('Failed to load app data');
      console.error('Error loading app data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDeploymentHistory = async (deploymentName: string) => {
    try {
      setIsLoadingHistory(true);
      const result = await api.getDeploymentHistory(appName, deploymentName);
      setDeploymentHistory(result.history || []);
    } catch (error) {
      console.error('Error loading deployment history:', error);
      setDeploymentHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleCreateDeployment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeploymentName.trim()) {
      setError('Deployment name is required');
      return;
    }

    setIsCreatingDeployment(true);
    setError('');

    try {
      await api.createDeployment(appName, newDeploymentName.trim());
      setNewDeploymentName('');
      setShowCreateDeployment(false);
      await loadAppData();
    } catch (error) {
      setError('Failed to create deployment');
      console.error('Error creating deployment:', error);
    } finally {
      setIsCreatingDeployment(false);
    }
  };

  const handleDeleteDeployment = async (deploymentName: string) => {
    if (!confirm(`Are you sure you want to delete the deployment "${deploymentName}"?`)) {
      return;
    }

    try {
      await api.deleteDeployment(appName, deploymentName);
      await loadAppData();
      if (selectedDeployment === deploymentName) {
        setSelectedDeployment('');
        setDeploymentHistory([]);
      }
    } catch (error) {
      setError('Failed to delete deployment');
      console.error('Error deleting deployment:', error);
    }
  };

  const handlePromoteRelease = async (fromDeployment: string, toDeployment: string) => {
    try {
      await api.promoteRelease(appName, fromDeployment, toDeployment);
      await loadDeploymentHistory(selectedDeployment);
    } catch (error) {
      setError('Failed to promote release');
      console.error('Error promoting release:', error);
    }
  };

  const handleRollback = async (deploymentName: string, targetRelease?: string) => {
    if (!confirm('Are you sure you want to rollback this deployment?')) {
      return;
    }

    try {
      await api.rollbackRelease(appName, deploymentName, targetRelease);
      await loadDeploymentHistory(selectedDeployment);
    } catch (error) {
      setError('Failed to rollback release');
      console.error('Error rolling back:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <AuthGuard>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">{appName}</h1>
                  <p className="mt-1 text-sm text-gray-500">App deployments and releases</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-600">{error}</p>
              </div>
            )}

            {/* Deployments section */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Deployments</h2>
                <button
                  onClick={() => setShowCreateDeployment(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Deployment
                </button>
              </div>

              {/* Create deployment form */}
              {showCreateDeployment && (
                <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg shadow">
                  <form onSubmit={handleCreateDeployment} className="space-y-4">
                    <div>
                      <label htmlFor="deploymentName" className="block text-sm font-medium text-gray-700">
                        Deployment Name
                      </label>
                      <input
                        id="deploymentName"
                        type="text"
                        value={newDeploymentName}
                        onChange={(e) => setNewDeploymentName(e.target.value)}
                        placeholder="e.g., Production, Staging, Beta"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex space-x-3">
                      <button
                        type="submit"
                        disabled={isCreatingDeployment}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {isCreatingDeployment ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateDeployment(false);
                          setNewDeploymentName('');
                          setError('');
                        }}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Deployments list */}
              {deployments.length === 0 ? (
                <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
                  <p className="text-gray-500">No deployments found. Create your first deployment to get started.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {deployments.map((deployment) => (
                    <div key={deployment.name} className="bg-white rounded-lg border border-gray-200 p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="text-lg font-medium text-gray-900">{deployment.name}</h3>
                        <button
                          onClick={() => handleDeleteDeployment(deployment.name)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm text-gray-500 mb-3">Key: {deployment.key}</p>
                      <button
                        onClick={() => setSelectedDeployment(deployment.name)}
                        className={`w-full px-3 py-2 text-sm font-medium rounded-md ${
                          selectedDeployment === deployment.name
                            ? 'bg-indigo-100 text-indigo-700'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        View History
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Release history section */}
            {selectedDeployment && (
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  Release History - {selectedDeployment}
                </h2>
                
                {isLoadingHistory ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                  </div>
                ) : deploymentHistory.length === 0 ? (
                  <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
                    <p className="text-gray-500">No releases found for this deployment.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {deploymentHistory.map((release, index) => (
                      <div key={release.label} className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                {release.label}
                              </span>
                              {release.isMandatory && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  Mandatory
                                </span>
                              )}
                              {release.isDisabled && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                  Disabled
                                </span>
                              )}
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-1">{release.description || 'No description'}</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm text-gray-500">
                              <div>App Version: {release.appVersion}</div>
                              <div>Size: {formatFileSize(release.size)}</div>
                              <div>Released: {formatDate(release.uploadTime)}</div>
                              <div>Released by: {release.releasedBy || 'Unknown'}</div>
                              {release.rollout && <div>Rollout: {release.rollout}%</div>}
                              {release.releaseMethod && <div>Method: {release.releaseMethod}</div>}
                            </div>
                          </div>
                          <div className="flex space-x-2 ml-4">
                            {index === 0 && (
                              <button
                                onClick={() => handleRollback(selectedDeployment)}
                                className="px-3 py-1 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100"
                              >
                                Rollback
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}