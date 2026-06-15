-- SQLite DDL mirroring schema.prisma (used by db-init.mjs; equivalent to `prisma db push`)
CREATE TABLE IF NOT EXISTS "Property" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "bdcHotelId" TEXT,
  "expediaHotelId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "RoomType" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "propertyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "bdcRoomId" TEXT,
  "expediaName" TEXT,
  "expediaRoomId" TEXT,
  "expediaRatePlanId" TEXT,
  "physicalRooms" TEXT NOT NULL,
  "totalUnits" INTEGER NOT NULL,
  "basePrice" REAL NOT NULL DEFAULT 80,
  CONSTRAINT "RoomType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RateOverride" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "roomTypeId" INTEGER NOT NULL,
  "date" TEXT NOT NULL,
  "price" REAL NOT NULL,
  CONSTRAINT "RateOverride_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RateOverride_roomTypeId_date_key" ON "RateOverride"("roomTypeId", "date");

CREATE TABLE IF NOT EXISTS "Booking" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "propertyId" TEXT NOT NULL DEFAULT 'streatham',
  "roomTypeId" INTEGER, -- null = unallocated (no room type assigned yet)
  "physicalRoom" TEXT, -- e.g. '10'; null = unallocated
  "guestName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "checkIn" TEXT NOT NULL,
  "checkOut" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 1,
  "adults" INTEGER NOT NULL DEFAULT 1,
  "children" INTEGER NOT NULL DEFAULT 0,
  "channel" TEXT NOT NULL,
  "channelRef" TEXT,
  "totalPrice" REAL,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "notes" TEXT,
  "stripeSessionId" TEXT,
  "stripePaymentUrl" TEXT,
  "stripeStatus" TEXT,
  "paidAt" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Booking_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "CrmRecord" (
  "bookingId" INTEGER NOT NULL PRIMARY KEY,
  "preStayCall" TEXT NOT NULL DEFAULT '',
  "preStayDate" TEXT,
  "formSent" TEXT NOT NULL DEFAULT '',
  "formCompleted" TEXT NOT NULL DEFAULT '',
  "midStayCall" TEXT NOT NULL DEFAULT '',
  "msDate" TEXT,
  "checkinRating" INTEGER,
  "cleanlinessRating" INTEGER,
  "issueFlagged" TEXT,
  "taskGiven" TEXT,
  "firstContact" TEXT NOT NULL DEFAULT '',
  "fcDate" TEXT,
  "feedback" TEXT,
  "rebookingInterest" TEXT NOT NULL DEFAULT '',
  "directBookingOffered" TEXT NOT NULL DEFAULT '',
  "promoCodeGiven" TEXT,
  "secondContact" TEXT NOT NULL DEFAULT '',
  "scDate" TEXT,
  "review" TEXT NOT NULL DEFAULT '',
  "reviewDate" TEXT,
  "reviewScore" REAL,
  "issueReport" TEXT,
  "guestSentiment" TEXT NOT NULL DEFAULT '',
  "updatedAt" DATETIME,
  CONSTRAINT "Crm_booking_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExtrasRequest" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bookingReference" TEXT NOT NULL,
  "bookingId" INTEGER,
  "extra" TEXT NOT NULL,
  "date" TEXT,
  "time" TEXT,
  "nights" INTEGER,
  "price" REAL,
  "sourceStatus" TEXT,
  "taskStatus" TEXT NOT NULL DEFAULT 'pending',
  "raw" TEXT,
  "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Extras_dedupe"
  ON "ExtrasRequest"("bookingReference", "extra", COALESCE("date",''), COALESCE("time",''));

CREATE TABLE IF NOT EXISTS "Block" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "roomTypeId" INTEGER NOT NULL,
  "date" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT,
  CONSTRAINT "Block_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Block_roomTypeId_date_key" ON "Block"("roomTypeId", "date");

CREATE TABLE IF NOT EXISTS "SyncJob" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "channel" TEXT NOT NULL,
  "roomTypeId" INTEGER NOT NULL,
  "date" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt" DATETIME,
  CONSTRAINT "SyncJob_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
