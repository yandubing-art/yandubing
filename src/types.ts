export type BitableRecord = {
  record_id: string;
  fields: Record<string, unknown>;
  created_time?: number;
  last_modified_time?: number;
};

export type DispatchTask = {
  recordId: string;
  taskNumber: string;
  requester: string;
  requesterId: string;
  departureTime: Date | null;
  origin: string;
  destination: string;
  tripMode: string;
  transferLocation: string;
  returnOrigin: string;
  returnDestination: string;
  vehicle: string;
  vehicleModel: string;
  mileage: number | null;
  nextMaintenanceMileage: number | null;
  maintenanceReminder: string;
  status: string;
  stage: string;
  departurePhotos: PhotoAttachment[];
  departurePhotoTime: Date | null;
  departureCheckResult: string;
  departurePhotoNotes: string;
  returnMileage: number | null;
  returnPhotos: PhotoAttachment[];
  returnPhotoTime: Date | null;
  returnCheckResult: string;
  returnPhotoNotes: string;
  damageDescription: string;
  appJobId: string;
  result: string;
  error: string;
};

export type PhotoAttachment = {
  name: string;
  url: string;
  fileToken?: string;
};

export type PhotoUpload = {
  position: "front" | "rear" | "left" | "right" | "extra";
  dataUrl: string;
  capturedAt?: string;
};

export type StoreOption = {
  id: string;
  name: string;
};

export type UserOption = {
  id: string;
  name: string;
  enName: string;
  department: string;
  avatarUrl: string;
};

export type VehicleProfile = {
  tableId: string;
  tableName: string;
  recordId: string;
  plate: string;
  brand: string;
  model: string;
  modelDescription: string;
  brandField: string;
  vehicleType: string;
  typeField: string;
  status: string;
  statusField: string;
  owner: string;
  ownerField: string;
  year: string;
  yearField: string;
  registeringAuthority: string;
  registeringAuthorityField: string;
  lastServiceDate: string;
  lastServiceDateField: string;
  serviceProvider: string;
  serviceProviderField: string;
  spareKey: string;
  spareKeyField: string;
  registerNumber: string;
  registerNumberField: string;
  vehicleIdentificationNumber: string;
  vehicleIdentificationNumberField: string;
  certificateExpiry: string;
  certificateExpiryField: string;
  logBookAttachments: Array<{ name: string; url: string; fileToken?: string }>;
  logBookField: string;
  policyNumber: string;
  policyNumberField: string;
  insurance: string;
  insuranceField: string;
  fnbFleetCard: string;
  fnbFleetCardField: string;
  fleetCardPhotoUrl: string;
  fleetCardPhotoField: string;
  selectFieldNames: string[];
  dispatchEligible: boolean;
  photoUrl: string;
  mileage: number | null;
  nextMaintenanceMileage: number | null;
  nextMaintenanceDate: string;
  dateFieldNames: string[];
  plateField: string;
  modelField: string;
  photoField: string;
  currentMileageField: string;
  nextMaintenanceMileageField: string;
  nextMaintenanceDateField: string;
  photoFieldConfigured: boolean;
  photoFullUrl?: string;
};

export type VehicleMatchResult = {
  status: "matched" | "not_found" | "ambiguous";
  query: string;
  message: string;
  vehicle?: VehicleProfile;
};

export type VehicleSyncResult = {
  status: "updated" | "unchanged" | "not_found" | "ambiguous" | "skipped";
  message: string;
  matched: boolean;
  updated: boolean;
  vehicle?: VehicleProfile;
};

export type ExecutorResponse = {
  status?: "accepted" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
};
