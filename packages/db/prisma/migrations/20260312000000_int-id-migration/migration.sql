-- AlterTable: ScheduleType id TEXT -> SERIAL (INT autoincrement)
-- Drop foreign keys referencing ScheduleType.id first
ALTER TABLE "Period" DROP CONSTRAINT "Period_scheduleTypeId_fkey";
ALTER TABLE "SchoolCalendar" DROP CONSTRAINT "SchoolCalendar_scheduleTypeId_fkey";

-- Drop primary key constraint on ScheduleType
ALTER TABLE "ScheduleType" DROP CONSTRAINT "ScheduleType_pkey";

-- Change ScheduleType.id from TEXT to SERIAL
ALTER TABLE "ScheduleType" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ScheduleType" ALTER COLUMN "id" TYPE INTEGER USING ("id"::INTEGER);
CREATE SEQUENCE IF NOT EXISTS "ScheduleType_id_seq";
ALTER TABLE "ScheduleType" ALTER COLUMN "id" SET DEFAULT nextval('"ScheduleType_id_seq"');
ALTER SEQUENCE "ScheduleType_id_seq" OWNED BY "ScheduleType"."id";
ALTER TABLE "ScheduleType" ADD CONSTRAINT "ScheduleType_pkey" PRIMARY KEY ("id");

-- Change Period.scheduleTypeId from TEXT to INTEGER
ALTER TABLE "Period" ALTER COLUMN "scheduleTypeId" TYPE INTEGER USING ("scheduleTypeId"::INTEGER);

-- Change SchoolCalendar.scheduleTypeId from TEXT to INTEGER
ALTER TABLE "SchoolCalendar" ALTER COLUMN "scheduleTypeId" TYPE INTEGER USING ("scheduleTypeId"::INTEGER);

-- AlterTable: Period id TEXT -> SERIAL
ALTER TABLE "Period" DROP CONSTRAINT "Period_pkey";
ALTER TABLE "Period" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Period" ALTER COLUMN "id" TYPE INTEGER USING ("id"::INTEGER);
CREATE SEQUENCE IF NOT EXISTS "Period_id_seq";
ALTER TABLE "Period" ALTER COLUMN "id" SET DEFAULT nextval('"Period_id_seq"');
ALTER SEQUENCE "Period_id_seq" OWNED BY "Period"."id";
ALTER TABLE "Period" ADD CONSTRAINT "Period_pkey" PRIMARY KEY ("id");

-- AlterTable: SchoolCalendar id TEXT -> SERIAL
ALTER TABLE "SchoolCalendar" DROP CONSTRAINT "SchoolCalendar_pkey";
ALTER TABLE "SchoolCalendar" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "SchoolCalendar" ALTER COLUMN "id" TYPE INTEGER USING ("id"::INTEGER);
CREATE SEQUENCE IF NOT EXISTS "SchoolCalendar_id_seq";
ALTER TABLE "SchoolCalendar" ALTER COLUMN "id" SET DEFAULT nextval('"SchoolCalendar_id_seq"');
ALTER SEQUENCE "SchoolCalendar_id_seq" OWNED BY "SchoolCalendar"."id";
ALTER TABLE "SchoolCalendar" ADD CONSTRAINT "SchoolCalendar_pkey" PRIMARY KEY ("id");

-- AlterTable: Destination id TEXT -> SERIAL
ALTER TABLE "Destination" DROP CONSTRAINT "Destination_pkey";
ALTER TABLE "Destination" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Destination" ALTER COLUMN "id" TYPE INTEGER USING ("id"::INTEGER);
CREATE SEQUENCE IF NOT EXISTS "Destination_id_seq";
ALTER TABLE "Destination" ALTER COLUMN "id" SET DEFAULT nextval('"Destination_id_seq"');
ALTER SEQUENCE "Destination_id_seq" OWNED BY "Destination"."id";
ALTER TABLE "Destination" ADD CONSTRAINT "Destination_pkey" PRIMARY KEY ("id");

-- AlterTable: PassPolicy id TEXT -> SERIAL
ALTER TABLE "PassPolicy" DROP CONSTRAINT "PassPolicy_pkey";
ALTER TABLE "PassPolicy" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "PassPolicy" ALTER COLUMN "id" TYPE INTEGER USING ("id"::INTEGER);
CREATE SEQUENCE IF NOT EXISTS "PassPolicy_id_seq";
ALTER TABLE "PassPolicy" ALTER COLUMN "id" SET DEFAULT nextval('"PassPolicy_id_seq"');
ALTER SEQUENCE "PassPolicy_id_seq" OWNED BY "PassPolicy"."id";
ALTER TABLE "PassPolicy" ADD CONSTRAINT "PassPolicy_pkey" PRIMARY KEY ("id");

-- Re-add foreign keys now that types match
ALTER TABLE "Period" ADD CONSTRAINT "Period_scheduleTypeId_fkey" FOREIGN KEY ("scheduleTypeId") REFERENCES "ScheduleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolCalendar" ADD CONSTRAINT "SchoolCalendar_scheduleTypeId_fkey" FOREIGN KEY ("scheduleTypeId") REFERENCES "ScheduleType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
