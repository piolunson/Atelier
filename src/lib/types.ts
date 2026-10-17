export type Role = "admin" | "creator";
export type FileKind = "image" | "video" | "audio" | "pdf" | "file";
export type ReviewStatus = "pending" | "approved" | "changes_requested";
export type FontKey = "cormorant" | "playfair" | "inter";
export type RoomTheme = "dark" | "light";
export type BgType = "image" | "preset" | "color";
export type LayoutMode = "grid" | "masonry";
export type RoomStatus = "draft" | "active" | "disabled";
export type ReviewState = "pending" | "changes" | "approved";

export type Brand = {
  logoUrl: string | null;
  accentColor: string;
  fontKey: FontKey;
  theme: RoomTheme;
  backgroundType: BgType;
  backgroundValue: string;
  layout: LayoutMode;
};

export type CoCreator = { name: string };

export type Profile = {
  id: string;
  email: string;
  role: Role;
  displayName: string;
  avatarUrl: string | null;
  storageLimitBytes: number;
  storageUsedBytes: number;
  mustChangePassword: boolean;
  isActive: boolean;
  notifyOpen: boolean;
  notifyComments: boolean;
  notifyAccept: boolean;
  notifyReviews: boolean;
  notifyDigest: boolean;
  hidePoweredBy: boolean;
};

export type RoomCard = {
  id: string;
  slug: string;
  title: string;
  clientName: string;
  status: RoomStatus;
  reviewState: ReviewState;
  expiresAt: string | null;
  fileCount: number;
  totalBytes: number;
  approvedCount: number;
  coverThumb: string | null;
  updatedAt: string;
  opened: boolean;
};

export type WizardFile = {
  id: string;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  thumb: string | null;
  position: number;
  isCover: boolean;
};

export type DraftRoom = {
  id: string;
  slug: string;
  title: string;
  clientName: string;
  clientEmail: string;
  message: string;
  coCreators: CoCreator[];
  status: RoomStatus;
  validityDays: number | null;
  hasPassword: boolean;
  allowZip: boolean;
  allowDownload: boolean;
  hidePoweredBy: boolean;
  brand: Brand;
  files: WizardFile[];
};

export type PublicFile = {
  id: string;
  name: string;
  kind: FileKind;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb: string | null;
  status: ReviewStatus;
  commentCount: number;
  hasDownload: boolean;
};

export type PublicRoomOk = {
  state: "ok";
  slug: string;
  title: string;
  clientName: string;
  message: string;
  ownerName: string;
  ownerAvatar: string | null;
  coCreators: CoCreator[];
  allowZip: boolean;
  allowDownload: boolean;
  hidePoweredBy: boolean;
  brand: Brand;
  files: PublicFile[];
  coverPreview: string | null;
  coverId: string | null;
};

export type PublicRoom =
  | { state: "missing" }
  | { state: "expired" }
  | { state: "disabled" }
  | { state: "locked" }
  | PublicRoomOk;

export type Comment = {
  id: string;
  authorType: "client" | "creator";
  authorName: string;
  body: string;
  createdAt: string;
};

export type ManagedFile = {
  id: string;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  thumb: string | null;
  position: number;
  status: ReviewStatus;
  commentCount: number;
  deletedAt: string | null;
};

export type ActivityItem = {
  id: string;
  type: string;
  actorName: string | null;
  fileId: string | null;
  createdAt: string;
};

export type ManagedRoom = {
  id: string;
  slug: string;
  title: string;
  clientName: string;
  clientEmail: string;
  message: string;
  status: RoomStatus;
  reviewState: ReviewState;
  expiresAt: string | null;
  validityDays: number | null;
  hasPassword: boolean;
  allowZip: boolean;
  allowDownload: boolean;
  hidePoweredBy: boolean;
  brand: Brand;
  files: ManagedFile[];
  activity: ActivityItem[];
  comments: (Comment & { fileId: string; fileName: string })[];
  opens: number;
  downloads: number;
  approved: number;
  total: number;
};

export type Testimonial = {
  id: string;
  rating: number;
  body: string;
  authorName: string;
  authorRole: string | null;
};

