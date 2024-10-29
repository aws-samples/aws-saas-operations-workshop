import { ComputeType, IBuildImage, LinuxArmLambdaBuildImage } from 'aws-cdk-lib/aws-codebuild';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export const applicationName = 'SaaSOpsV2';
export const codeBuildBuildImage: IBuildImage = LinuxArmLambdaBuildImage.AMAZON_LINUX_2023_NODE_20;
export const codeBuildComputeType: ComputeType = ComputeType.LAMBDA_2GB;
export const runtime: Runtime = Runtime.NODEJS_20_X;
export const sharedUserPassword = 'Stopthatthats51llY!';

export enum TenantRole {
  Admin = 'ADMIN',
  User = 'USER',
}

export enum TenantTier {
  Basic = 'BASIC',
  Premium = 'PREMIUM',
}

export enum Status {
  Failed = 'FAILED',
  InProgress = 'IN_PROGRESS',
  Succeeded = 'SUCCEEDED',
}

export enum CellStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
  Provisioning = 'PROVISIONING',
  Deprovisioning = 'DEPROVISIONING',
}

export enum TenantStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
  Migrating = 'MIGRATING',
  Restoring = 'RESTORING'
}

export enum ExportType {
  Archive = 'ARCHIVE',
  Migrate = 'MIGRATE'
}

export enum ControlPlaneEventBusDetailType {
  DeprovisioningRequest = 'DEPROVISIONING_REQUEST',
  DeprovisioningSuccess = 'DEPROVISIONING_SUCCESS',
  DeprovisioningFailure = 'DEPROVISIONING_FAILURE',
  LoadTestingRequest = 'LOAD_TESTING_REQUEST',
  LoadTestingSuccess = 'LOAD_TESTING_SUCCESS',
  LoadTestingFailure = 'LOAD_TESTING_FAILURE',
  OffboardingRequest = 'OFFBOARDING_REQUEST',
  OffboardingSuccess = 'OFFBOARDING_SUCCESS',
  OffboardingFailure = 'OFFBOARDING_FAILURE',
  OnboardingRequest = 'ONBOARDING_REQUEST',
  OnboardingSuccess = 'ONBOARDING_SUCCESS',
  OnboardingFailure = 'ONBOARDING_FAILURE',
  ProvisioningRequest = 'PROVISIONING_REQUEST',
  ProvisioningSuccess = 'PROVISIONING_SUCCESS',
  ProvisioningFailure = 'PROVISIONING_FAILURE',
  TenantBackupRequest = 'TENANT_BACKUP_REQUEST',
  TenantBackupSuccess = 'TENANT_BACKUP_SUCCESS',
  TenantBackupFailure = 'TENANT_BACKUP_FAILURE',
  TenantDataDeleteRequest = 'TENANT_DATA_DELETE_REQUEST',
  TenantDataDeleteSuccess = 'TENANT_DATA_DELETE_SUCCESS',
  TenantDataDeleteFailure = 'TENANT_DATA_DELETE_FAILURE',
  TenantDataExportRequest = 'TENANT_DATA_EXPORT_REQUEST',
  TenantDataExportSuccess = 'TENANT_DATA_EXPORT_SUCCESS',
  TenantDataExportFailure = 'TENANT_DATA_EXPORT_FAILURE',
  TenantDataImportRequest = 'TENANT_DATA_IMPORT_REQUEST',
  TenantDataImportSuccess = 'TENANT_DATA_IMPORT_SUCCESS',
  TenantDataImportFailure = 'TENANT_DATA_IMPORT_FAILURE',
  TenantDeleteRequest = 'TENANT_DELETE_REQUEST',
  TenantDeleteSuccess = 'TENANT_DELETE_SUCCESS',
  TenantDeleteFailure = 'TENANT_DELETE_FAILURE',
  TenantExportRequest = 'TENANT_EXPORT_REQUEST',
  TenantExportSuccess = 'TENANT_EXPORT_SUCCESS',
  TenantExportFailure = 'TENANT_EXPORT_FAILURE',
  TenantImportRequest = 'TENANT_IMPORT_REQUEST',
  TenantImportSuccess = 'TENANT_IMPORT_SUCCESS',
  TenantImportFailure = 'TENANT_IMPORT_FAILURE',
  TenantMigrateRequest = 'TENANT_MIGRATE_REQUEST',
  TenantMigrateSuccess = 'TENANT_MIGRATE_SUCCESS',
  TenantMigrateFailure = 'TENANT_MIGRATE_FAILURE',
  TenantRestoreRequest = 'TENANT_RESTORE_REQUEST',
  TenantRestoreSuccess = 'TENANT_RESTORE_SUCCESS',
  TenantRestoreFailure = 'TENANT_RESTORE_FAILURE',
  TenantUserDeleteRequest = 'TENANT_USER_DELETE_REQUEST',
  TenantUserDeleteSuccess = 'TENANT_USER_DELETE_SUCCESS',
  TenantUserDeleteFailure = 'TENANT_USER_DELETE_FAILURE',
  TenantUserExportRequest = 'TENANT_USER_EXPORT_REQUEST',
  TenantUserExportSuccess = 'TENANT_USER_EXPORT_SUCCESS',
  TenantUserExportFailure = 'TENANT_USER_EXPORT_FAILURE',
  TenantUserImportRequest = 'TENANT_USER_IMPORT_REQUEST',
  TenantUserImportSuccess = 'TENANT_USER_IMPORT_SUCCESS',
  TenantUserImportFailure = 'TENANT_USER_IMPORT_FAILURE',
  SfnCallback = 'SFN_CALLBACK',
}

export enum ControlPlaneEventBusEventSource {
  controlPlane = 'SAAS_CONTROL_PLANE',
}

export interface Cell {
  stackName: string;
  status: CellStatus;
  tier?: TenantTier;
  clientId?: string;
  dataTableArn?: string;
  dataTableName?: string;
  url?: string;
  userPoolId?: string;
}

export interface User {
  email: string;
  username: string;
  role: string;
}

export interface TenantUser extends User {
  tenantId: string;
  tier: string;
}

export interface Tenant {
  tenantId: string; // immutable
  tenantName: string;
  tier: TenantTier;
  apiKey: string;
  stackName?: string;
  status?: TenantStatus;
  userPoolId?: string;
}