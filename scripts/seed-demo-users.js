/**
 * Seed Demo Users for ZipschoolOS
 *
 * Creates 2 demo schools + 26 users (13 per school) + super admin already exists.
 * Run: node scripts/seed-demo-users.js
 */
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const AUTH_URI = process.env.AUTH_MONGODB_URI;
const STAFF_URI = process.env.STAFF_MONGODB_URI;
const STUDENT_URI = process.env.STUDENT_MONGODB_URI;
const ACADEMIC_URI = process.env.ACADEMIC_MONGODB_URI;

const PASSWORD_HASH = "$2b$10$YQ8GvFOBScFGH3KoCz3KrOJBMBxHvZcEqVrJYDq4DK1C/fdDNZGO"; // Demo@1234

const SCHOOLS = [
  { name: "Demo School 1", slug: "demo-school-1" },
  { name: "Demo School 2", slug: "demo-school-2" },
];

const USERS_PER_SCHOOL = [
  { role: "school_admin", designation: null, prefix: "schooladmin", staffRole: null },
  { role: "teacher", designation: null, prefix: "classteacher1", staffRole: "teacher", staffDesignation: "Class Teacher - Nursery A" },
  { role: "teacher", designation: null, prefix: "classteacher2", staffRole: "teacher", staffDesignation: "Class Teacher - LKG A" },
  { role: "teacher", designation: null, prefix: "teacher3", staffRole: "teacher", staffDesignation: "TGT English" },
  { role: "staff", designation: "accountant", prefix: "accountant1", staffRole: "admin-staff", staffDesignation: "Accountant" },
  { role: "staff", designation: "librarian", prefix: "librarian1", staffRole: "support", staffDesignation: "Librarian" },
  { role: "staff", designation: "receptionist", prefix: "receptionist1", staffRole: "admin-staff", staffDesignation: "Receptionist" },
  { role: "staff", designation: "transport", prefix: "transport1", staffRole: "support", staffDesignation: "Transport In-Charge" },
  { role: "staff", designation: "admission_counsellor", prefix: "counsellor1", staffRole: "admin-staff", staffDesignation: "Admission Counsellor" },
  { role: "student", prefix: "student1", name: "Demo Student I", admissionNo: "DS1NUR001", class: "Nursery", section: "A" },
  { role: "student", prefix: "student2", name: "Demo Student II", admissionNo: "DS1NUR002", class: "Nursery", section: "A" },
  { role: "student", prefix: "student3", name: "Demo Student III", admissionNo: "DS1LKG001", class: "LKG", section: "A" },
  { role: "student", prefix: "student4", name: "Demo Student IV", admissionNo: "DS1LKG002", class: "LKG", section: "A" },
];

async function seed() {
  console.log("Connecting to databases...");

  const authConn = await mongoose.createConnection(AUTH_URI).asPromise();
  const staffConn = await mongoose.createConnection(STAFF_URI).asPromise();
  const studentConn = await mongoose.createConnection(STUDENT_URI).asPromise();
  const academicConn = await mongoose.createConnection(ACADEMIC_URI).asPromise();

  console.log("Connected.\n");

  const AuthUser = authConn.model("User", new mongoose.Schema({
    name: String, email: { type: String, unique: true }, password: String,
    role: String, designation: String, schoolId: mongoose.Schema.Types.ObjectId,
    refId: String, isActive: { type: Boolean, default: true }, emailVerified: { type: Boolean, default: true },
  }, { collection: "users", timestamps: true }));

  const AuthSchool = authConn.model("School", new mongoose.Schema({
    name: String, slug: { type: String, unique: true }, status: String,
    currentSession: String, settings: mongoose.Schema.Types.Mixed,
  }, { collection: "schools", timestamps: true }));

  const Staff = staffConn.model("Staff", new mongoose.Schema({
    schoolId: mongoose.Schema.Types.ObjectId, employeeId: String, userId: String,
    name: String, designation: String, role: String, status: String, salary: Number,
    contact: String, email: String, gender: String,
  }, { collection: "staffs", timestamps: true }));

  const Student = studentConn.model("Student", new mongoose.Schema({
    schoolId: mongoose.Schema.Types.ObjectId, admissionNo: String, name: String,
    class: String, section: String, status: String, gender: String,
    contact: String, email: String, parentName: String,
  }, { collection: "students", timestamps: true }));

  // Check existing
  const existingSchools = await AuthUser.distinct("schoolId");
  const existingEmails = new Set((await AuthUser.find({}).select("email").lean()).map((u) => u.email));

  console.log(`Existing schools: ${existingSchools.length}`);
  console.log(`Existing users: ${existingEmails.size}\n`);

  let schoolsCreated = 0;
  let usersCreated = 0;
  let staffCreated = 0;
  let studentsCreated = 0;

  for (const schoolDef of SCHOOLS) {
    // Create or find school
    let school = await AuthSchool.findOne({ slug: schoolDef.slug }).lean();
    if (!school) {
      school = await AuthSchool.create({
        name: schoolDef.name, slug: schoolDef.slug, status: "active",
        currentSession: "2026-27", settings: {},
      });
      schoolsCreated++;
      console.log(`Created school: ${schoolDef.name} (${school._id})`);
    } else {
      console.log(`Found school: ${schoolDef.name} (${school._id})`);
    }

    const schoolId = school._id;
    const schoolNum = SCHOOLS.indexOf(schoolDef) + 1;

    for (const uDef of USERS_PER_SCHOOL) {
      const email = `${uDef.prefix}.demoschool${schoolNum}@edu.in`;

      if (existingEmails.has(email)) {
        console.log(`  Skip (exists): ${email}`);
        continue;
      }

      const personName = uDef.name || uDef.prefix
        .replace(/(\d+)/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .replace(/(\d)/g, "")

      if (uDef.role === "student") {
        // Create student record first
        const admNo = schoolNum === 1 ? uDef.admissionNo : uDef.admissionNo.replace("DS1", "DS2");
        const studentRecord = await Student.create({
          schoolId, admissionNo: admNo, name: uDef.name,
          class: uDef.class, section: uDef.section, status: "Active",
          gender: "Male", contact: "9999999999", email,
          parentName: "Demo Parent",
        });
        studentsCreated++;

        // Create user linked to student
        const user = await AuthUser.create({
          name: uDef.name, email, password: PASSWORD_HASH,
          role: "student", schoolId, refId: admNo,
          isActive: true, emailVerified: true,
        });
        usersCreated++;
        existingEmails.add(email);
        console.log(`  Created: ${email} (student, ${admNo})`);
      } else if (uDef.role === "school_admin") {
        const user = await AuthUser.create({
          name: `Demo Admin ${schoolNum}`, email, password: PASSWORD_HASH,
          role: "school_admin", schoolId, isActive: true, emailVerified: true,
        });
        usersCreated++;
        existingEmails.add(email);
        console.log(`  Created: ${email} (school_admin)`);
      } else {
        // Teacher or Staff — create Staff record first
        const empId = `${uDef.prefix.toUpperCase()}-DS${schoolNum}`;
        const staffRecord = await Staff.create({
          schoolId, employeeId: empId, name: personName,
          designation: uDef.staffDesignation, role: uDef.staffRole,
          status: "Active", salary: uDef.role === "teacher" ? 40000 : 30000,
          contact: "9999999999", email, gender: "Male",
        });
        staffCreated++;

        // Create user linked to staff
        const user = await AuthUser.create({
          name: personName, email, password: PASSWORD_HASH,
          role: uDef.role, designation: uDef.designation,
          schoolId, refId: String(staffRecord._id),
          isActive: true, emailVerified: true,
        });

        // Link back
        await Staff.updateOne({ _id: staffRecord._id }, { $set: { userId: String(user._id) } });

        usersCreated++;
        existingEmails.add(email);
        console.log(`  Created: ${email} (${uDef.role}, ${uDef.designation || "no designation"}, empId=${empId})`);
      }
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`SEED COMPLETE`);
  console.log(`  Schools created: ${schoolsCreated}`);
  console.log(`  Staff records:   ${staffCreated}`);
  console.log(`  Student records: ${studentsCreated}`);
  console.log(`  Users created:   ${usersCreated}`);
  console.log(`${"=".repeat(50)}`);

  await authConn.close();
  await staffConn.close();
  await studentConn.close();
  await academicConn.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
