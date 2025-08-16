// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as q from "q";
import * as shortid from "shortid";
import * as stream from "stream";
import * as storage from "./storage";
import * as utils from "../utils/common";

import { Storage as CloudStorage, Bucket } from "@google-cloud/storage";
import { Firestore } from "@google-cloud/firestore";
import { isPrototypePollutionKey } from "./storage";

module Keys {
  const DELIMITER = " ";
  const LEAF_MARKER = "*";

  export function getAccountPartitionKey(accountId: string): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    return "accountId" + DELIMITER + accountId;
  }

  export function getAccountAddress(accountId: string): Pointer {
    validateParameters(Array.prototype.slice.apply(arguments));
    return <Pointer>{
      partitionKeyPointer: getAccountPartitionKey(accountId),
      rowKeyPointer: getHierarchicalAccountRowKey(accountId),
    };
  }

  export function getAppPartitionKey(appId: string): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    return "appId" + DELIMITER + appId;
  }

  export function getHierarchicalAppRowKey(appId?: string, deploymentId?: string): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    return generateHierarchicalAppKey(/*markLeaf=*/ true, appId, deploymentId);
  }

  export function getHierarchicalAccountRowKey(accountId: string, appId?: string): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    return generateHierarchicalAccountKey(/*markLeaf=*/ true, accountId, appId);
  }

  export function generateHierarchicalAppKey(markLeaf: boolean, appId: string, deploymentId?: string): string {
    validateParameters(Array.prototype.slice.apply(arguments).slice(1));
    let key = delimit("appId", appId, /*prependDelimiter=*/ false);

    if (typeof deploymentId !== "undefined") {
      key += delimit("deploymentId", deploymentId);
    }

    if (markLeaf) {
      const lastIdDelimiter: number = key.lastIndexOf(DELIMITER);
      key = key.substring(0, lastIdDelimiter) + LEAF_MARKER + key.substring(lastIdDelimiter);
    }

    return key;
  }

  export function generateHierarchicalAccountKey(markLeaf: boolean, accountId: string, appId?: string): string {
    validateParameters(Array.prototype.slice.apply(arguments).slice(1));
    let key = delimit("accountId", accountId, /*prependDelimiter=*/ false);

    if (typeof appId !== "undefined") {
      key += delimit("appId", appId);
    }

    if (markLeaf) {
      const lastIdDelimiter: number = key.lastIndexOf(DELIMITER);
      key = key.substring(0, lastIdDelimiter) + LEAF_MARKER + key.substring(lastIdDelimiter);
    }

    return key;
  }

  export function getAccessKeyRowKey(accountId: string, accessKeyId?: string): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    let key: string = "accountId_" + accountId + "_accessKeyId*_";

    if (accessKeyId !== undefined) {
      key += accessKeyId;
    }

    return key;
  }

  export function isDeployment(rowKey: string): boolean {
    return rowKey.indexOf("deploymentId*") !== -1;
  }

  export function getEmailShortcutAddress(email: string): Pointer {
    validateParameters(Array.prototype.slice.apply(arguments));
    return <Pointer>{
      partitionKeyPointer: "email" + DELIMITER + email.toLowerCase(),
      rowKeyPointer: "",
    };
  }

  export function getShortcutDeploymentKeyPartitionKey(deploymentKey: string): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    return delimit("deploymentKey", deploymentKey, /*prependDelimiter=*/ false);
  }

  export function getShortcutDeploymentKeyRowKey(): string {
    return "";
  }

  export function getShortcutAccessKeyPartitionKey(accessKeyName: string, hash: boolean = true): string {
    validateParameters(Array.prototype.slice.apply(arguments));
    return delimit("accessKey", hash ? utils.hashWithSHA256(accessKeyName) : accessKeyName, /*prependDelimiter=*/ false);
  }

  function validateParameters(parameters: string[]): void {
    parameters.forEach((parameter: string): void => {
      if (parameter && (parameter.indexOf(DELIMITER) >= 0 || parameter.indexOf(LEAF_MARKER) >= 0)) {
        throw storage.storageError(storage.ErrorCode.Invalid, `The parameter '${parameter}' contained invalid characters.`);
      }
    });
  }

  function delimit(fieldName: string, value: string, prependDelimiter = true): string {
    const prefix = prependDelimiter ? DELIMITER : "";
    return prefix + fieldName + DELIMITER + value;
  }
}

interface Pointer {
  partitionKeyPointer: string;
  rowKeyPointer: string;
}

interface DeploymentKeyPointer {
  appId: string;
  deploymentId: string;
}

interface AccessKeyPointer {
  accountId: string;
  expires: number;
}

export class GCSStorage implements storage.Storage {
  public static NO_ID_ERROR = "No id set";

  private static HISTORY_BLOB_CONTAINER_NAME = "packagehistoryv1";
  private static MAX_PACKAGE_HISTORY_LENGTH = 50;
  private static COLLECTION_NAME = "storagev2";

  private _firestore: Firestore;
  private _storage: CloudStorage;
  private _bucket: Bucket;
  private _historyBucket: Bucket;
  private _setupPromise: q.Promise<void>;

  public constructor(projectId?: string, keyFilename?: string, bucketName?: string) {
    shortid.characters("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-");

    this._setupPromise = this.setup(projectId, keyFilename, bucketName);
  }

  public reinitialize(projectId?: string, keyFilename?: string, bucketName?: string): q.Promise<void> {
    console.log("Re-initializing GCS storage");
    return this.setup(projectId, keyFilename, bucketName);
  }

  public checkHealth(): q.Promise<void> {
    return q.Promise<void>((resolve, reject) => {
      this._setupPromise
        .then(() => {
          const collectionCheck: q.Promise<void> = q.Promise<void>((docResolve, docReject) => {
            this._firestore
              .collection(GCSStorage.COLLECTION_NAME)
              .doc("health")
              .get()
              .then((doc) => {
                if (!doc.exists || doc.data()?.health !== "health") {
                  // Try to create the health document if it doesn't exist
                  return this._firestore
                    .collection(GCSStorage.COLLECTION_NAME)
                    .doc("health")
                    .set({ health: "health" })
                    .then(() => docResolve())
                    .catch(docReject);
                } else {
                  docResolve();
                }
              })
              .catch((error) => {
                // If collection doesn't exist, try to create the health document
                if (error.code === 5 || error.code === "not-found") {
                  return this._firestore
                    .collection(GCSStorage.COLLECTION_NAME)
                    .doc("health")
                    .set({ health: "health" })
                    .then(() => docResolve())
                    .catch(docReject);
                }
                docReject(error);
              });
          });

          const acquisitionBlobCheck: q.Promise<void> = this.blobHealthCheck(this._bucket);
          const historyBlobCheck: q.Promise<void> = this.blobHealthCheck(this._historyBucket);

          return q.all([collectionCheck, acquisitionBlobCheck, historyBlobCheck]);
        })
        .then(() => {
          resolve();
        })
        .catch(reject);
    });
  }

  public addAccount(account: storage.Account): q.Promise<string> {
    account = storage.clone(account);
    account.id = shortid.generate();

    const hierarchicalAddress: Pointer = Keys.getAccountAddress(account.id);
    const emailShortcutAddress: Pointer = Keys.getEmailShortcutAddress(account.email);

    const accountPointer: Pointer = Keys.getEmailShortcutAddress(account.email);

    return this._setupPromise
      .then(() => {
        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(emailShortcutAddress.partitionKeyPointer, emailShortcutAddress.rowKeyPointer));
        return docRef.set(this.wrap(account, emailShortcutAddress.partitionKeyPointer, emailShortcutAddress.rowKeyPointer));
      })
      .then(() => {
        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(hierarchicalAddress.partitionKeyPointer, hierarchicalAddress.rowKeyPointer));
        return docRef.set(this.wrap(accountPointer, hierarchicalAddress.partitionKeyPointer, hierarchicalAddress.rowKeyPointer));
      })
      .then(() => {
        return account.id;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getAccount(accountId: string): q.Promise<storage.Account> {
    const address: Pointer = Keys.getAccountAddress(accountId);

    return this._setupPromise
      .then(() => {
        return this.retrieveByKey(address.partitionKeyPointer, address.rowKeyPointer);
      })
      .then((pointer: Pointer) => {
        return this.retrieveByKey(pointer.partitionKeyPointer, pointer.rowKeyPointer);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getAccountByEmail(email: string): q.Promise<storage.Account> {
    const address: Pointer = Keys.getEmailShortcutAddress(email);
    return this._setupPromise
      .then(() => {
        return this.retrieveByKey(address.partitionKeyPointer, address.rowKeyPointer);
      })
      .catch((gcsError: any): any => {
        GCSStorage.gcsErrorHandler(
          gcsError,
          true,
          "not-found",
          "The specified e-mail address doesn't represent a registered user"
        );
      });
  }

  public updateAccount(email: string, updateProperties: storage.Account): q.Promise<void> {
    if (!email) throw new Error("No account email");
    const address: Pointer = Keys.getEmailShortcutAddress(email);
    const updates: any = {
      azureAdId: updateProperties.azureAdId,
      gitHubId: updateProperties.gitHubId,
      microsoftId: updateProperties.microsoftId,
    };

    return this._setupPromise
      .then(() => {
        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(address.partitionKeyPointer, address.rowKeyPointer));
        return docRef.update(updates);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getAccountIdFromAccessKey(accessKey: string): q.Promise<string> {
    const partitionKey: string = Keys.getShortcutAccessKeyPartitionKey(accessKey);
    const rowKey: string = "";

    return this._setupPromise
      .then(() => {
        return this.retrieveByKey(partitionKey, rowKey);
      })
      .then((accountIdObject: AccessKeyPointer) => {
        if (new Date().getTime() >= accountIdObject.expires) {
          throw storage.storageError(storage.ErrorCode.Expired, "The access key has expired.");
        }

        return accountIdObject.accountId;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public addApp(accountId: string, app: storage.App): q.Promise<storage.App> {
    app = storage.clone(app);
    app.id = shortid.generate();

    return this._setupPromise
      .then(() => {
        return this.getAccount(accountId);
      })
      .then((account: storage.Account) => {
        const collabMap: storage.CollaboratorMap = {};
        collabMap[account.email] = { accountId: accountId, permission: storage.Permissions.Owner };

        app.collaborators = collabMap;

        const flatApp: any = GCSStorage.flattenApp(app, /*updateCollaborator*/ true);
        return this.insertByAppHierarchy(flatApp, app.id);
      })
      .then(() => {
        return this.addAppPointer(accountId, app.id);
      })
      .then(() => {
        return app;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getApps(accountId: string): q.Promise<storage.App[]> {
    return this._setupPromise
      .then(() => {
        return this.getCollectionByHierarchy(accountId);
      })
      .then((flatApps: any[]) => {
        // Filter to only process app pointers (objects with partitionKeyPointer and rowKeyPointer)
        const appPointers = flatApps.filter((item: any) => 
          item && item.partitionKeyPointer && item.rowKeyPointer &&
          item.partitionKeyPointer.startsWith('appId ')
        );
        
        console.log(`[DEBUG] getApps - filtered ${appPointers.length} app pointers from ${flatApps.length} total objects`);
        
        // Resolve each pointer to get the actual app document
        const appPromises = appPointers.map((pointer: any) => {
          const partitionKey = pointer.partitionKeyPointer;
          const rowKey = pointer.rowKeyPointer;
          console.log(`[DEBUG] Resolving pointer: ${partitionKey} / ${rowKey}`);
          return this.retrieveByKey(partitionKey, rowKey)
            .then((flatApp: any) => {
              console.log(`[DEBUG] Retrieved app:`, flatApp);
              return GCSStorage.unflattenApp(flatApp, accountId);
            })
            .catch((error: any) => {
              console.log(`[DEBUG] Failed to resolve pointer ${partitionKey}: ${error.message}`);
              return null; // Return null for failed retrievals
            });
        });

        return q.all(appPromises).then((apps: (storage.App | null)[]) => {
          // Filter out null values (failed retrievals)
          return apps.filter((app: storage.App | null) => app !== null) as storage.App[];
        });
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getApp(accountId: string, appId: string, _keepCollaboratorIds: boolean = false): q.Promise<storage.App> { // eslint-disable-line no-unused-vars
    return this._setupPromise
      .then(() => {
        return this.retrieveByAppHierarchy(appId);
      })
      .then((flatApp: any) => {
        return GCSStorage.unflattenApp(flatApp, accountId);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public removeApp(accountId: string, appId: string): q.Promise<void> {
    console.log(`[DEBUG] removeApp - starting removal of appId: ${appId}, accountId: ${accountId}`);
    return this._setupPromise
      .then(() => {
        console.log(`[DEBUG] removeApp - calling removeAllCollaboratorsAppPointers`);
        return this.removeAllCollaboratorsAppPointers(accountId, appId);
      })
      .then(() => {
        console.log(`[DEBUG] removeApp - calling cleanUpByAppHierarchy`);
        return this.cleanUpByAppHierarchy(appId);
      })
      .then(() => {
        console.log(`[DEBUG] removeApp - completed successfully`);
      })
      .catch((error: any) => {
        console.error(`[ERROR] removeApp - failed:`, error);
        throw error;
      });
  }

  public updateApp(accountId: string, app: storage.App): q.Promise<void> {
    const appId: string = app.id;
    if (!appId) throw new Error("No app id");

    return this._setupPromise
      .then(() => {
        return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ false);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public transferApp(accountId: string, appId: string, email: string): q.Promise<void> {
    let app: storage.App;
    let targetCollaboratorAccountId: string;
    let requestingCollaboratorEmail: string;
    let isTargetAlreadyCollaborator: boolean;

    return this._setupPromise
      .then(() => {
        const getAppPromise: q.Promise<storage.App> = this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
        const accountPromise: q.Promise<storage.Account> = this.getAccountByEmail(email);
        return q.all<any>([getAppPromise, accountPromise]);
      })
      .spread((appPromiseResult: storage.App, accountPromiseResult: storage.Account) => {
        targetCollaboratorAccountId = accountPromiseResult.id;
        email = accountPromiseResult.email;
        app = appPromiseResult;
        requestingCollaboratorEmail = GCSStorage.getEmailForAccountId(app.collaborators, accountId);

        if (requestingCollaboratorEmail === email) {
          throw storage.storageError(storage.ErrorCode.AlreadyExists, "The given account already owns the app.");
        }

        return this.getApps(targetCollaboratorAccountId);
      })
      .then((appsForCollaborator: storage.App[]) => {
        if (storage.NameResolver.isDuplicate(appsForCollaborator, app.name)) {
          throw storage.storageError(
            storage.ErrorCode.AlreadyExists,
            'Cannot transfer ownership. An app with name "' + app.name + '" already exists for the given collaborator.'
          );
        }

        isTargetAlreadyCollaborator = GCSStorage.isCollaborator(app.collaborators, email);

        GCSStorage.setCollaboratorPermission(app.collaborators, requestingCollaboratorEmail, storage.Permissions.Collaborator);

        if (isTargetAlreadyCollaborator) {
          GCSStorage.setCollaboratorPermission(app.collaborators, email, storage.Permissions.Owner);
        } else {
          const targetOwnerProperties: storage.CollaboratorProperties = {
            accountId: targetCollaboratorAccountId,
            permission: storage.Permissions.Owner,
          };
          GCSStorage.addToCollaborators(app.collaborators, email, targetOwnerProperties);
        }

        return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true);
      })
      .then(() => {
        if (!isTargetAlreadyCollaborator) {
          return this.addAppPointer(targetCollaboratorAccountId, app.id);
        }
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public addCollaborator(accountId: string, appId: string, email: string): q.Promise<void> {
    return this._setupPromise
      .then(() => {
        const getAppPromise: q.Promise<storage.App> = this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
        const accountPromise: q.Promise<storage.Account> = this.getAccountByEmail(email);
        return q.all<any>([getAppPromise, accountPromise]);
      })
      .spread((app: storage.App, account: storage.Account) => {
        email = account.email;
        return this.addCollaboratorWithPermissions(accountId, app, email, {
          accountId: account.id,
          permission: storage.Permissions.Collaborator,
        });
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getCollaborators(accountId: string, appId: string): q.Promise<storage.CollaboratorMap> {
    return this._setupPromise
      .then(() => {
        return this.getApp(accountId, appId, /*keepCollaboratorIds*/ false);
      })
      .then((app: storage.App) => {
        return q<storage.CollaboratorMap>(app.collaborators);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public removeCollaborator(accountId: string, appId: string, email: string): q.Promise<void> {
    return this._setupPromise
      .then(() => {
        return this.getApp(accountId, appId, /*keepCollaboratorIds*/ true);
      })
      .then((app: storage.App) => {
        const removedCollabProperties: storage.CollaboratorProperties = app.collaborators[email];

        if (!removedCollabProperties) {
          throw storage.storageError(storage.ErrorCode.NotFound, "The given email is not a collaborator for this app.");
        }

        if (!GCSStorage.isOwner(app.collaborators, email)) {
          delete app.collaborators[email];
        } else {
          throw storage.storageError(storage.ErrorCode.AlreadyExists, "Cannot remove the owner of the app from collaborator list.");
        }

        return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true).then(() => {
          return this.removeAppPointer(removedCollabProperties.accountId, app.id);
        });
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<string> {
    let deploymentId: string;
    return this._setupPromise
      .then(() => {
        const flatDeployment: any = GCSStorage.flattenDeployment(deployment);
        flatDeployment.id = shortid.generate();

        return this.insertByAppHierarchy(flatDeployment, appId, flatDeployment.id);
      })
      .then((returnedId: string) => {
        deploymentId = returnedId;
        return this.uploadToHistoryBlob(deploymentId, JSON.stringify([]));
      })
      .then(() => {
        const shortcutPartitionKey: string = Keys.getShortcutDeploymentKeyPartitionKey(deployment.key);
        const shortcutRowKey: string = Keys.getShortcutDeploymentKeyRowKey();
        const pointer: DeploymentKeyPointer = {
          appId: appId,
          deploymentId: deploymentId,
        };

        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(shortcutPartitionKey, shortcutRowKey));
        return docRef.set(this.wrap(pointer, shortcutPartitionKey, shortcutRowKey));
      })
      .then(() => {
        return deploymentId;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getDeploymentInfo(deploymentKey: string): q.Promise<storage.DeploymentInfo> {
    const partitionKey: string = Keys.getShortcutDeploymentKeyPartitionKey(deploymentKey);
    const rowKey: string = Keys.getShortcutDeploymentKeyRowKey();

    return this._setupPromise
      .then(() => {
        return this.retrieveByKey(partitionKey, rowKey);
      })
      .then((pointer: DeploymentKeyPointer): storage.DeploymentInfo => {
        if (!pointer) {
          return null;
        }

        return { appId: pointer.appId, deploymentId: pointer.deploymentId };
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getPackageHistoryFromDeploymentKey(deploymentKey: string): q.Promise<storage.Package[]> {
    const pointerPartitionKey: string = Keys.getShortcutDeploymentKeyPartitionKey(deploymentKey);
    const pointerRowKey: string = Keys.getShortcutDeploymentKeyRowKey();

    return this._setupPromise
      .then(() => {
        return this.retrieveByKey(pointerPartitionKey, pointerRowKey);
      })
      .then((pointer: DeploymentKeyPointer) => {
        if (!pointer) return null;

        return this.getPackageHistoryFromBlob(pointer.deploymentId);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Deployment> {
    return this._setupPromise
      .then(() => {
        return this.retrieveByAppHierarchy(appId, deploymentId);
      })
      .then((flatDeployment: any) => {
        return GCSStorage.unflattenDeployment(flatDeployment);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getDeployments(accountId: string, appId: string): q.Promise<storage.Deployment[]> {
    return this._setupPromise
      .then(() => {
        return this.getCollectionByHierarchy(accountId, appId);
      })
      .then((flatDeployments: any[]) => {
        const deployments: storage.Deployment[] = [];
        flatDeployments.forEach((flatDeployment: any) => {
          deployments.push(GCSStorage.unflattenDeployment(flatDeployment));
        });

        return deployments;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public removeDeployment(accountId: string, appId: string, deploymentId: string): q.Promise<void> {
    return this._setupPromise
      .then(() => {
        return this.cleanUpByAppHierarchy(appId, deploymentId);
      })
      .then(() => {
        return this.deleteHistoryBlob(deploymentId);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): q.Promise<void> {
    const deploymentId: string = deployment.id;
    if (!deploymentId) throw new Error("No deployment id");

    return this._setupPromise
      .then(() => {
        const flatDeployment: any = GCSStorage.flattenDeployment(deployment);
        return this.mergeByAppHierarchy(flatDeployment, appId, deploymentId);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public commitPackage(
    accountId: string,
    appId: string,
    deploymentId: string,
    appPackage: storage.Package
  ): q.Promise<storage.Package> {
    if (!deploymentId) throw new Error("No deployment id");
    if (!appPackage) throw new Error("No package specified");

    appPackage = storage.clone(appPackage);

    let packageHistory: storage.Package[];
    return this._setupPromise
      .then(() => {
        return this.getPackageHistoryFromBlob(deploymentId);
      })
      .then((history: storage.Package[]) => {
        packageHistory = history;
        appPackage.label = this.getNextLabel(packageHistory);
        return this.getAccount(accountId);
      })
      .then((account: storage.Account) => {
        appPackage.releasedBy = account.email;

        const lastPackage: storage.Package =
          packageHistory && packageHistory.length ? packageHistory[packageHistory.length - 1] : null;
        if (lastPackage) {
          lastPackage.rollout = null;
        }

        packageHistory.push(appPackage);

        if (packageHistory.length > GCSStorage.MAX_PACKAGE_HISTORY_LENGTH) {
          packageHistory.splice(0, packageHistory.length - GCSStorage.MAX_PACKAGE_HISTORY_LENGTH);
        }

        const flatPackage: any = { id: deploymentId, package: JSON.stringify(appPackage) };
        return this.mergeByAppHierarchy(flatPackage, appId, deploymentId);
      })
      .then(() => {
        return this.uploadToHistoryBlob(deploymentId, JSON.stringify(packageHistory));
      })
      .then((): storage.Package => {
        return appPackage;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public clearPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<void> {
    return this._setupPromise
      .then(() => {
        return this.retrieveByAppHierarchy(appId, deploymentId);
      })
      .then((flatDeployment: any) => {
        delete flatDeployment.package;
        return this.updateByAppHierarchy(flatDeployment, appId, deploymentId);
      })
      .then(() => {
        return this.uploadToHistoryBlob(deploymentId, JSON.stringify([]));
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getPackageHistory(accountId: string, appId: string, deploymentId: string): q.Promise<storage.Package[]> {
    return this._setupPromise
      .then(() => {
        return this.getPackageHistoryFromBlob(deploymentId);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public updatePackageHistory(accountId: string, appId: string, deploymentId: string, history: storage.Package[]): q.Promise<void> {
    if (!history || !history.length) {
      throw storage.storageError(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation");
    }

    return this._setupPromise
      .then(() => {
        const flatDeployment: any = { id: deploymentId, package: JSON.stringify(history[history.length - 1]) };
        return this.mergeByAppHierarchy(flatDeployment, appId, deploymentId);
      })
      .then(() => {
        return this.uploadToHistoryBlob(deploymentId, JSON.stringify(history));
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public addBlob(blobId: string, stream: stream.Readable, _streamLength: number): q.Promise<string> { // eslint-disable-line no-unused-vars
    return this._setupPromise
      .then(() => {
        return utils.streamToBuffer(stream);
      })
      .then((buffer) => {
        const file = this._bucket.file(blobId);
        return file.save(Buffer.from(buffer));
      })
      .then(() => {
        return blobId;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getBlobUrl(blobId: string): q.Promise<string> {
    return this._setupPromise
      .then(() => {
        const file = this._bucket.file(blobId);
        // Generate a signed URL that expires in 1 hour
        return file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });
      })
      .then((signedUrls) => {
        return signedUrls[0];
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public removeBlob(blobId: string): q.Promise<void> {
    return this._setupPromise
      .then(() => {
        const file = this._bucket.file(blobId);
        return file.delete();
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public addAccessKey(accountId: string, accessKey: storage.AccessKey): q.Promise<string> {
    accessKey = storage.clone(accessKey);
    accessKey.id = shortid.generate();

    return this._setupPromise
      .then(() => {
        const partitionKey: string = Keys.getShortcutAccessKeyPartitionKey(accessKey.name);
        const rowKey: string = "";
        const accessKeyPointer: AccessKeyPointer = { accountId, expires: accessKey.expires };
        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(partitionKey, rowKey));
        return docRef.set(this.wrap(accessKeyPointer, partitionKey, rowKey));
      })
      .then(() => {
        return this.insertAccessKey(accessKey, accountId);
      })
      .then((): string => {
        return accessKey.id;
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getAccessKey(accountId: string, accessKeyId: string): q.Promise<storage.AccessKey> {
    const partitionKey: string = Keys.getAccountPartitionKey(accountId);
    const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKeyId);
    return this._setupPromise
      .then(() => {
        return this.retrieveByKey(partitionKey, rowKey);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public getAccessKeys(accountId: string): q.Promise<storage.AccessKey[]> {
    const deferred = q.defer<storage.AccessKey[]>();

    const partitionKey: string = Keys.getAccountPartitionKey(accountId);
    const rowKey: string = Keys.getHierarchicalAccountRowKey(accountId);
    const searchKey: string = Keys.getAccessKeyRowKey(accountId);

    this._setupPromise.then(() => {
      this._firestore
        .collection(GCSStorage.COLLECTION_NAME)
        .where("partitionKey", "==", partitionKey)
        .get()
        .then((querySnapshot) => {
          if (querySnapshot.empty) {
            throw storage.storageError(storage.ErrorCode.NotFound);
          }

          const objects: storage.AccessKey[] = [];

          querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.rowKey !== rowKey && data.rowKey.startsWith(searchKey)) {
              objects.push(this.unwrap(data));
            }
          });

          deferred.resolve(objects);
        })
        .catch((error: any) => {
          deferred.reject(error);
        });
    });

    return deferred.promise;
  }

  public removeAccessKey(accountId: string, accessKeyId: string): q.Promise<void> {
    return this._setupPromise
      .then(() => {
        return this.getAccessKey(accountId, accessKeyId);
      })
      .then((accessKey) => {
        const partitionKey: string = Keys.getAccountPartitionKey(accountId);
        const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKeyId);
        const shortcutAccessKeyPartitionKey: string = Keys.getShortcutAccessKeyPartitionKey(accessKey.name, false);

        const docRef1 = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(partitionKey, rowKey));
        const docRef2 = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(shortcutAccessKeyPartitionKey, ""));

        return q.all<any>([docRef1.delete(), docRef2.delete()]);
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public updateAccessKey(accountId: string, accessKey: storage.AccessKey): q.Promise<void> {
    if (!accessKey) {
      throw new Error("No access key");
    }

    if (!accessKey.id) {
      throw new Error("No access key id");
    }

    const partitionKey: string = Keys.getAccountPartitionKey(accountId);
    const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKey.id);

    return this._setupPromise
      .then(() => {
        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(partitionKey, rowKey));
        return docRef.update(this.wrap(accessKey, partitionKey, rowKey));
      })
      .then(() => {
        const newAccessKeyPointer: AccessKeyPointer = {
          accountId,
          expires: accessKey.expires,
        };

        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(Keys.getShortcutAccessKeyPartitionKey(accessKey.name, false), ""));
        return docRef.update(this.wrap(newAccessKeyPointer, Keys.getShortcutAccessKeyPartitionKey(accessKey.name, false), ""));
      })
      .catch(GCSStorage.gcsErrorHandler);
  }

  public dropAll(): q.Promise<void> {
    return q(<void>null);
  }

  private setup(projectId?: string, keyFilename?: string, bucketName?: string): q.Promise<void> {
    const _projectId = projectId || process.env.GOOGLE_CLOUD_PROJECT_ID;
    const _keyFilename = keyFilename || process.env.GOOGLE_CLOUD_KEY_FILE;
    const _bucketName = bucketName || process.env.GOOGLE_CLOUD_STORAGE_BUCKET || "code-push-server";

    if (!_projectId) {
      throw new Error("Google Cloud Project ID not set");
    }

    const options: any = { projectId: _projectId };
    if (_keyFilename) {
      options.keyFilename = _keyFilename;
    }

    options.databaseId = process.env.GOOGLE_CLOUD_FIRESTORE_DATABASE || "(default)";
    this._firestore = new Firestore(options);
    this._storage = new CloudStorage(options);
    this._bucket = this._storage.bucket(_bucketName);
    this._historyBucket = this._storage.bucket(`${_bucketName}-${GCSStorage.HISTORY_BLOB_CONTAINER_NAME}`);

    const healthDocument = this.wrap({ health: "health" }, "health", "health");

    return q
      .all([
        this._bucket.exists().then(([exists]) => {
          if (!exists) {
            return this._bucket.create();
          }
        }),
        this._historyBucket.exists().then(([exists]) => {
          if (!exists) {
            return this._historyBucket.create();
          }
        }),
      ])
      .then(() => {
        return q.all<any>([
          this._firestore.collection(GCSStorage.COLLECTION_NAME).doc("health").set(healthDocument),
          this._bucket.file("health").save("health"),
          this._historyBucket.file("health").save("health"),
        ]);
      })
      .then(() => {
        // Assignment only after successful setup
      })
      .catch((error) => {
        throw error;
      });
  }

  private blobHealthCheck(bucket: Bucket): q.Promise<void> {
    const deferred = q.defer<void>();

    bucket
      .file("health")
      .download()
      .then(([contents]) => {
        if (contents.toString() !== "health") {
          deferred.reject(
            storage.storageError(
              storage.ErrorCode.ConnectionFailed,
              "The GCS Buckets service failed the health check for " + bucket.name
            )
          );
        } else {
          deferred.resolve();
        }
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private getPackageHistoryFromBlob(blobId: string): q.Promise<storage.Package[]> {
    const deferred = q.defer<storage.Package[]>();

    this._historyBucket
      .file(blobId)
      .download()
      .then(([contents]) => {
        const parsedContents = JSON.parse(contents.toString());
        deferred.resolve(parsedContents);
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private uploadToHistoryBlob(blobId: string, content: string): q.Promise<void> {
    const deferred = q.defer<void>();

    this._historyBucket
      .file(blobId)
      .save(content)
      .then(() => {
        deferred.resolve();
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private deleteHistoryBlob(blobId: string): q.Promise<void> {
    const deferred = q.defer<void>();

    this._historyBucket
      .file(blobId)
      .delete()
      .then(() => {
        deferred.resolve();
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private getDocumentId(partitionKey: string, rowKey: string): string {
    return `${partitionKey}__${rowKey}`.replace(/[\/]/g, "_");
  }

  private wrap(jsObject: any, partitionKey: string, rowKey: string): any {
    return {
      partitionKey,
      rowKey,
      ...jsObject,
    };
  }

  private unwrap(entity: any, includeKey?: boolean): any {
    const { partitionKey, rowKey, ...rest } = entity;
    return includeKey ? { partitionKey, rowKey, ...rest } : rest;
  }

  private addCollaboratorWithPermissions(
    accountId: string,
    app: storage.App,
    email: string,
    collabProperties: storage.CollaboratorProperties
  ): q.Promise<void> {
    if (app && app.collaborators && !app.collaborators[email]) {
      app.collaborators[email] = collabProperties;
      return this.updateAppWithPermission(accountId, app, /*updateCollaborator*/ true).then(() => {
        return this.addAppPointer(collabProperties.accountId, app.id);
      });
    } else {
      throw storage.storageError(storage.ErrorCode.AlreadyExists, "The given account is already a collaborator for this app.");
    }
  }

  private addAppPointer(accountId: string, appId: string): q.Promise<void> {
    const deferred = q.defer<void>();

    const appPartitionKey: string = Keys.getAppPartitionKey(appId);
    const appRowKey: string = Keys.getHierarchicalAppRowKey(appId);
    const pointer: Pointer = { partitionKeyPointer: appPartitionKey, rowKeyPointer: appRowKey };

    const accountPartitionKey: string = Keys.getAccountPartitionKey(accountId);
    const accountRowKey: string = Keys.getHierarchicalAccountRowKey(accountId, appId);

    console.log(`[DEBUG] Creating app pointer: accountId=${accountId}, appId=${appId}`);
    console.log(`[DEBUG] Account partition key: ${accountPartitionKey}`);
    console.log(`[DEBUG] Account row key: ${accountRowKey}`);
    console.log(`[DEBUG] Pointer:`, pointer);

    const docRef = this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .doc(this.getDocumentId(accountPartitionKey, accountRowKey));
    docRef
      .set(this.wrap(pointer, accountPartitionKey, accountRowKey))
      .then(() => {
        console.log(`[DEBUG] App pointer created successfully`);
        deferred.resolve();
      })
      .catch((error: any) => {
        console.error(`[ERROR] Failed to create app pointer:`, error);
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private removeAppPointer(accountId: string, appId: string): q.Promise<void> {
    const deferred = q.defer<void>();

    const accountPartitionKey: string = Keys.getAccountPartitionKey(accountId);
    const accountRowKey: string = Keys.getHierarchicalAccountRowKey(accountId, appId);

    const docRef = this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .doc(this.getDocumentId(accountPartitionKey, accountRowKey));
    docRef
      .delete()
      .then(() => {
        deferred.resolve();
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private removeAllCollaboratorsAppPointers(accountId: string, appId: string): q.Promise<void> {
    return this.getApp(accountId, appId, /*keepCollaboratorIds*/ true)
      .then((app: storage.App) => {
        const collaboratorMap: storage.CollaboratorMap = app.collaborators;

        const removalPromises: q.Promise<void>[] = [];

        Object.keys(collaboratorMap).forEach((key: string) => {
          const collabProperties: storage.CollaboratorProperties = collaboratorMap[key];
          removalPromises.push(this.removeAppPointer(collabProperties.accountId, app.id));
        });

        return q.allSettled(removalPromises);
      })
      .then(() => { });
  }

  private updateAppWithPermission(accountId: string, app: storage.App, updateCollaborator: boolean = false): q.Promise<void> {
    const appId: string = app.id;
    if (!appId) throw new Error("No app id");

    const flatApp: any = GCSStorage.flattenApp(app, updateCollaborator);
    return this.mergeByAppHierarchy(flatApp, appId);
  }

  private insertByAppHierarchy(jsObject: Object, appId: string, deploymentId?: string): Promise<string> {
    const leafId: string = arguments[arguments.length - 1];
    const appPartitionKey: string = Keys.getAppPartitionKey(appId);

    const args = Array.prototype.slice.call(arguments);
    args.shift();
    args.pop();

    let fetchParentPromise: Promise<any> = Promise.resolve(null);
    if (args.length > 0) {
      const parentRowKey: string = Keys.getHierarchicalAppRowKey.apply(null, args);
      const docRef = this._firestore
        .collection(GCSStorage.COLLECTION_NAME)
        .doc(this.getDocumentId(appPartitionKey, parentRowKey));
      fetchParentPromise = docRef.get();
    }

    return fetchParentPromise
      .then(() => {
        const appRowKey: string = Keys.getHierarchicalAppRowKey(appId, deploymentId);
        const pointer: Pointer = { partitionKeyPointer: appPartitionKey, rowKeyPointer: appRowKey };
        const docRef = this._firestore
          .collection(GCSStorage.COLLECTION_NAME)
          .doc(this.getDocumentId(pointer.partitionKeyPointer, pointer.rowKeyPointer));
        return docRef.set(this.wrap(jsObject, pointer.partitionKeyPointer, pointer.rowKeyPointer));
      })
      .then(() => {
        return leafId;
      });
  }

  private insertAccessKey(accessKey: storage.AccessKey, accountId: string): q.Promise<string> {
    accessKey = storage.clone(accessKey);
    accessKey.name = utils.hashWithSHA256(accessKey.name);

    const deferred = q.defer<string>();

    const partitionKey: string = Keys.getAccountPartitionKey(accountId);
    const rowKey: string = Keys.getAccessKeyRowKey(accountId, accessKey.id);

    const docRef = this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .doc(this.getDocumentId(partitionKey, rowKey));

    docRef
      .set(this.wrap(accessKey, partitionKey, rowKey))
      .then(() => {
        deferred.resolve(accessKey.id);
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private retrieveByKey(partitionKey: string, rowKey: string): any {
    const docRef = this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .doc(this.getDocumentId(partitionKey, rowKey));
    return docRef.get().then((doc) => {
      if (!doc.exists) {
        throw storage.storageError(storage.ErrorCode.NotFound);
      }
      return this.unwrap(doc.data());
    });
  }

  private retrieveByAppHierarchy(appId: string, deploymentId?: string): q.Promise<any> {
    const partitionKey: string = Keys.getAppPartitionKey(appId);
    const rowKey: string = Keys.getHierarchicalAppRowKey(appId, deploymentId);
    return this.retrieveByKey(partitionKey, rowKey);
  }

  private async getCollectionByHierarchy(accountId: string, appId?: string, deploymentId?: string): Promise<any[]> {
    let partitionKey: string;
    let rowKey: string;

    const searchKeyArgs: any[] = Array.prototype.slice.call(arguments);
    searchKeyArgs.unshift(/*markLeaf=*/ true);
    searchKeyArgs.push(/*leafId=*/ "");

    if (appId) {
      searchKeyArgs.splice(1, 1);
      partitionKey = Keys.getAppPartitionKey(appId);
      rowKey = Keys.getHierarchicalAppRowKey(appId, deploymentId);
    } else {
      partitionKey = Keys.getAccountPartitionKey(accountId);
      rowKey = Keys.getHierarchicalAccountRowKey(accountId);
    }

    console.log(`[DEBUG] Query - accountId: ${accountId}, appId: ${appId}, deploymentId: ${deploymentId}`);
    console.log(`[DEBUG] Query - partitionKey: ${partitionKey}`);
    console.log(`[DEBUG] Query - rowKey: ${rowKey}`);

    const querySnapshot = await this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .where("partitionKey", "==", partitionKey)
      .get();

    console.log(`[DEBUG] Query - found ${querySnapshot.docs.length} documents`);

    const objects: any[] = [];
    let foundParent = false;
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`[DEBUG] Doc - id: ${doc.id}, partitionKey: ${data.partitionKey}, rowKey: ${data.rowKey}`);
      if (data.rowKey === rowKey) {
        foundParent = true;
        console.log(`[DEBUG] Found parent entity`);
      } else {
        console.log(`[DEBUG] Adding to objects:`, this.unwrap(data));
        objects.push(this.unwrap(data));
      }
    });

    console.log(`[DEBUG] Result - foundParent: ${foundParent}, objects.length: ${objects.length}`);

    // Only throw error if we can't find the parent entity (account/app doesn't exist)
    // but allow empty collections (no apps for account, no deployments for app)
    if (!foundParent && objects.length === 0 && !appId) {
      // For account queries, we need the account to exist
      throw new Error("Entity not found");
    }

    return objects;
  }

  private async cleanUpByAppHierarchy(appId: string, deploymentId?: string): Promise<void> {
    const partitionKey: string = Keys.getAppPartitionKey(appId);
    const rowKey: string = Keys.getHierarchicalAppRowKey(appId, deploymentId);
    const descendantsSearchKey: string = Keys.generateHierarchicalAppKey(/*markLeaf=*/ false, appId, deploymentId);

    const querySnapshot = await this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .where("partitionKey", "==", partitionKey)
      .get();

    const batch = this._firestore.batch();
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.rowKey === rowKey || data.rowKey.startsWith(descendantsSearchKey)) {
        batch.delete(doc.ref);
      }
    });

    if (!querySnapshot.empty) {
      await batch.commit();
    }
  }

  private mergeByAppHierarchy(jsObject: Object, appId: string, deploymentId?: string): q.Promise<void> {
    const deferred = q.defer<void>();

    const partitionKey: string = Keys.getAppPartitionKey(appId);
    const rowKey: string = Keys.getHierarchicalAppRowKey(appId, deploymentId);
    const docRef = this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .doc(this.getDocumentId(partitionKey, rowKey));

    docRef
      .update(this.wrap(jsObject, partitionKey, rowKey))
      .then(() => {
        deferred.resolve();
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private updateByAppHierarchy(jsObject: Object, appId: string, deploymentId?: string): q.Promise<void> {
    const deferred = q.defer<void>();

    const partitionKey: string = Keys.getAppPartitionKey(appId);
    const rowKey: string = Keys.getHierarchicalAppRowKey(appId, deploymentId);
    const docRef = this._firestore
      .collection(GCSStorage.COLLECTION_NAME)
      .doc(this.getDocumentId(partitionKey, rowKey));

    docRef
      .update(this.wrap(jsObject, partitionKey, rowKey))
      .then(() => {
        deferred.resolve();
      })
      .catch((error: any) => {
        deferred.reject(error);
      });

    return deferred.promise;
  }

  private getNextLabel(packageHistory: storage.Package[]): string {
    if (packageHistory.length === 0) {
      return "v1";
    }

    const lastLabel: string = packageHistory[packageHistory.length - 1].label;
    const lastVersion: number = parseInt(lastLabel.substring(1));
    return "v" + (lastVersion + 1);
  }

  private static gcsErrorHandler(
    gcsError: any,
    overrideMessage: boolean = false,
    overrideCondition?: string,
    overrideValue?: string
  ): any {
    let errorCodeRaw: number | string;
    let errorMessage: string;

    try {
      errorCodeRaw = gcsError.code;
      errorMessage = gcsError.message;
    } catch (error) {
      errorCodeRaw = "unknown";
      errorMessage = gcsError.toString();
    }

    if (overrideMessage && overrideCondition === errorCodeRaw) {
      errorMessage = overrideValue;
    }

    if (typeof errorCodeRaw === "number") {
      throw gcsError;
    }

    let errorCode: storage.ErrorCode;
    switch (errorCodeRaw) {
      case "not-found":
      case "5":
        errorCode = storage.ErrorCode.NotFound;
        break;
      case "already-exists":
      case "6":
        errorCode = storage.ErrorCode.AlreadyExists;
        break;
      case "resource-exhausted":
      case "8":
        errorCode = storage.ErrorCode.TooLarge;
        break;
      case "deadline-exceeded":
      case "4":
        errorCode = storage.ErrorCode.ConnectionFailed;
        break;
      default:
        errorCode = storage.ErrorCode.Other;
        break;
    }

    throw storage.storageError(errorCode, errorMessage);
  }

  private static deleteIsCurrentAccountProperty(map: storage.CollaboratorMap): void {
    if (map) {
      Object.keys(map).forEach((key: string) => {
        delete (<storage.CollaboratorProperties>map[key]).isCurrentAccount;
      });
    }
  }

  private static flattenApp(app: storage.App, updateCollaborator: boolean = false): any {
    if (!app) {
      return app;
    }

    const flatApp: any = {};
    for (const property in app) {
      if (property === "collaborators" && updateCollaborator) {
        GCSStorage.deleteIsCurrentAccountProperty(app.collaborators);
        flatApp[property] = JSON.stringify((<any>app)[property]);
      } else if (property !== "collaborators") {
        flatApp[property] = (<any>app)[property];
      }
    }

    return flatApp;
  }

  private static unflattenApp(flatApp: any, currentAccountId: string): storage.App {
    flatApp.collaborators = flatApp.collaborators ? JSON.parse(flatApp.collaborators) : {};

    const currentUserEmail: string = GCSStorage.getEmailForAccountId(flatApp.collaborators, currentAccountId);
    if (currentUserEmail && flatApp.collaborators[currentUserEmail]) {
      flatApp.collaborators[currentUserEmail].isCurrentAccount = true;
    }

    return flatApp;
  }

  private static flattenDeployment(deployment: storage.Deployment): any {
    if (!deployment) {
      return deployment;
    }

    const flatDeployment: any = {};
    for (const property in deployment) {
      if (property !== "package") {
        flatDeployment[property] = (<any>deployment)[property];
      }
    }

    return flatDeployment;
  }

  private static unflattenDeployment(flatDeployment: any): storage.Deployment {
    delete flatDeployment.packageHistory;
    flatDeployment.package = flatDeployment.package ? JSON.parse(flatDeployment.package) : null;

    return flatDeployment;
  }

  private static isOwner(collaboratorsMap: storage.CollaboratorMap, email: string): boolean {
    return (
      collaboratorsMap &&
      email &&
      collaboratorsMap[email] &&
      (<storage.CollaboratorProperties>collaboratorsMap[email]).permission === storage.Permissions.Owner
    );
  }

  private static isCollaborator(collaboratorsMap: storage.CollaboratorMap, email: string): boolean {
    return (
      collaboratorsMap &&
      email &&
      collaboratorsMap[email] &&
      (<storage.CollaboratorProperties>collaboratorsMap[email]).permission === storage.Permissions.Collaborator
    );
  }

  private static setCollaboratorPermission(collaboratorsMap: storage.CollaboratorMap, email: string, permission: string): void {
    if (collaboratorsMap && email && !isPrototypePollutionKey(email) && collaboratorsMap[email]) {
      (<storage.CollaboratorProperties>collaboratorsMap[email]).permission = permission;
    }
  }

  private static addToCollaborators(
    collaboratorsMap: storage.CollaboratorMap,
    email: string,
    collabProps: storage.CollaboratorProperties
  ): void {
    if (collaboratorsMap && email && !isPrototypePollutionKey(email) && !collaboratorsMap[email]) {
      collaboratorsMap[email] = collabProps;
    }
  }

  private static getEmailForAccountId(collaboratorsMap: storage.CollaboratorMap, accountId: string): string {
    if (collaboratorsMap) {
      for (const email of Object.keys(collaboratorsMap)) {
        if ((<storage.CollaboratorProperties>collaboratorsMap[email]).accountId === accountId) {
          return email;
        }
      }
    }

    return null;
  }
}