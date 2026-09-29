/**
 * Seed Missing Demo Users via API Gateway
 * Run: node scripts/seed-demo-users-api.js
 */
const BASE = "http://localhost:5000/api";

const SUPER_ADMIN = { email: "administrator@aiknotsit.com", password: "Administrator@321" };
const PASSWORD = "Demo@1234";

async function api(method, path, body, token, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function login(cred) {
  const r = await api("POST", "/auth/login", cred);
  if (!r.ok) throw new Error(`Login failed: ${JSON.stringify(r.data)}`);
  return r.data.data.accessToken;
}

async function main() {
  console.log("Logging in as super admin...");
  const token = await login(SUPER_ADMIN);
  console.log("Token obtained.\n");

  // Get existing users
  const existing = await api("GET", "/auth/users?limit=200", null, token);
  const existingEmails = new Set((existing.data.data || []).map((u) => u.email));
  console.log(`Existing users: ${existingEmails.size}`);

  // Get school IDs
  const schools = await api("GET", "/auth/schools", null, token);
  const school1 = (schools.data.data || []).find((s) => s.name === "Demo School 1");
  let school2 = (schools.data.data || []).find((s) => s.name === "Demo School 2");

  console.log(`School 1: ${school1?._id || "NOT FOUND"}`);

  if (!school2) {
    console.log("\nCreating Demo School 2...");
    const r = await api("POST", "/auth/schools", { name: "Demo School 2", code: "DS2" }, token);
    if (r.ok) {
      school2 = r.data.data;
      console.log(`  Created: ${school2._id}`);
    } else {
      console.error(`  FAILED: ${JSON.stringify(r.data)}`);
    }
  }
  console.log(`School 2: ${school2?._id || "NOT FOUND"}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  async function createUserSafe(email, payload) {
    if (existingEmails.has(email)) {
      console.log(`  Skip (exists): ${email}`);
      skipped++;
      return;
    }
    const r = await api("POST", "/auth/users", payload, token);
    if (r.ok) {
      console.log(`  Created: ${email}`);
      created++;
      existingEmails.add(email);
    } else {
      console.log(`  FAILED: ${email} — ${r.data.message || JSON.stringify(r.data)}`);
      failed++;
    }
  }

  // Helper: create staff record then user
  async function createStaffAndUser(schoolId, empPrefix, personName, staffRole, staffDesignation, userRole, userEmail, designation) {
    const empId = `${empPrefix}-${String(schoolId).slice(-4)}`;
    // Create staff record (skip if already exists)
    const staffPayload = {
      employeeId: empId,
      name: personName,
      designation: staffDesignation,
      role: staffRole,
      schoolId,
      contact: "9999999999",
      gender: "Male",
      salary: userRole === "teacher" ? 40000 : 30000,
    };
    const staffR = await api("POST", "/staff", staffPayload, token, { "X-School-Id": schoolId });
    if (staffR.ok) {
      console.log(`  Staff record created: ${staffR.data.data?._id} (empId=${empId})`);
    } else if (staffR.data.message && staffR.data.message.includes("already exists")) {
      console.log(`  Staff record exists: ${empId}`);
    } else {
      console.log(`  Staff FAILED for ${userEmail}: ${staffR.data.message || JSON.stringify(staffR.data)}`);
    }

    // Always try to create user — staff record might already exist
    await createUserSafe(userEmail, {
      email: userEmail,
      password: PASSWORD,
      role: userRole,
      designation: designation || undefined,
      name: personName,
      schoolId,
      refId: empId,
    });
  }

  // ═══════════════════════════════════════
  // School 1
  // ═══════════════════════════════════════
  console.log("=== School 1 (Demo School 1) ===");
  if (school1) {
    await createUserSafe("schooladmin1.demoschool1@edu.in", {
      email: "schooladmin1.demoschool1@edu.in", password: PASSWORD, role: "school_admin",
      name: "Demo School Admin 1", schoolId: school1._id,
    });

    await createStaffAndUser(school1._id, "CT1", "Demo Class Teacher I", "teacher", "Class Teacher - Nursery A", "teacher", "classteacher1.demoschool1@edu.in", null);
    await createStaffAndUser(school1._id, "CT2", "Demo Class Teacher II", "teacher", "Class Teacher - LKG A", "teacher", "classteacher2.demoschool1@edu.in", null);
    await createStaffAndUser(school1._id, "T3", "Demo Subject Teacher", "teacher", "TGT English", "teacher", "teacher3.demoschool1@edu.in", null);
    await createStaffAndUser(school1._id, "ACC", "Demo Accountant", "admin-staff", "Accountant", "staff", "accountant1.demoschool1@edu.in", "accountant");
    await createStaffAndUser(school1._id, "LIB", "Demo Librarian", "support", "Librarian", "staff", "librarian1.demoschool1@edu.in", "librarian");
    await createStaffAndUser(school1._id, "REC", "Demo Receptionist", "admin-staff", "Receptionist", "staff", "receptionist1.demoschool1@edu.in", "receptionist");
    await createStaffAndUser(school1._id, "TRN", "Demo Transport", "support", "Transport In-Charge", "staff", "transport1.demoschool1@edu.in", "transport");
    await createStaffAndUser(school1._id, "COU", "Demo Counsellor", "admin-staff", "Admission Counsellor", "staff", "counsellor1.demoschool1@edu.in", "admission_counsellor");

    // Students — create student records then user accounts
    const students = [
      { email: "student1.demoschool1@edu.in", name: "Demo Student I", admNo: "DS1NUR001", cls: "Nursery", sec: "A" },
      { email: "student2.demoschool1@edu.in", name: "Demo Student II", admNo: "DS1NUR002", cls: "Nursery", sec: "A" },
      { email: "student3.demoschool1@edu.in", name: "Demo Student III", admNo: "DS1LKG001", cls: "LKG", sec: "A" },
      { email: "student4.demoschool1@edu.in", name: "Demo Student IV", admNo: "DS1LKG002", cls: "LKG", sec: "A" },
    ];
    for (const s of students) {
      // Check if student record already exists
      const checkR = await api("GET", `/students?admissionNo=${s.admNo}`, null, token, { "X-School-Id": school1._id });
      if (checkR.ok && checkR.data.data?.length > 0) {
        console.log(`  Student record exists: ${s.admNo}`);
      } else {
        // Create student record
        const stuR = await api("POST", "/students", {
          admissionNo: s.admNo, name: s.name, class: s.cls, section: s.sec,
          gender: "Male", contact: "9999999999", parentName: "Demo Parent",
          schoolId: school1._id, session: "2026-27",
        }, token, { "X-School-Id": school1._id });
        if (!stuR.ok) {
          console.log(`  Student record FAILED ${s.admNo}: ${stuR.data.message || JSON.stringify(stuR.data)}`);
        }
      }
      // Create user linked to student
      await createUserSafe(s.email, {
        email: s.email, password: PASSWORD, role: "student",
        name: s.name, schoolId: school1._id, refId: s.admNo,
      });
    }
  }

  // ═══════════════════════════════════════
  // School 2
  // ═══════════════════════════════════════
  if (school2?._id) {
    console.log("\n=== School 2 (Demo School 2) ===");

    await createUserSafe("schooladmin2.demoschool2@edu.in", {
      email: "schooladmin2.demoschool2@edu.in", password: PASSWORD, role: "school_admin",
      name: "Demo School Admin 2", schoolId: school2._id,
    });

    await createStaffAndUser(school2._id, "CT1", "School2 Class Teacher I", "teacher", "Class Teacher - Nursery A", "teacher", "classteacher1.demoschool2@edu.in", null);
    await createStaffAndUser(school2._id, "CT2", "School2 Class Teacher II", "teacher", "Class Teacher - LKG A", "teacher", "classteacher2.demoschool2@edu.in", null);
    await createStaffAndUser(school2._id, "T3", "School2 Subject Teacher", "teacher", "TGT English", "teacher", "teacher3.demoschool2@edu.in", null);
    await createStaffAndUser(school2._id, "ACC", "School2 Accountant", "admin-staff", "Accountant", "staff", "accountant1.demoschool2@edu.in", "accountant");
    await createStaffAndUser(school2._id, "LIB", "School2 Librarian", "support", "Librarian", "staff", "librarian1.demoschool2@edu.in", "librarian");
    await createStaffAndUser(school2._id, "REC", "School2 Receptionist", "admin-staff", "Receptionist", "staff", "receptionist1.demoschool2@edu.in", "receptionist");
    await createStaffAndUser(school2._id, "TRN", "School2 Transport", "support", "Transport In-Charge", "staff", "transport1.demoschool2@edu.in", "transport");
    await createStaffAndUser(school2._id, "COU", "School2 Counsellor", "admin-staff", "Admission Counsellor", "staff", "counsellor1.demoschool2@edu.in", "admission_counsellor");

    const students2 = [
      { email: "student1.demoschool2@edu.in", name: "School2 Student I", admNo: "DS2NUR001", cls: "Nursery", sec: "A" },
      { email: "student2.demoschool2@edu.in", name: "School2 Student II", admNo: "DS2NUR002", cls: "Nursery", sec: "A" },
      { email: "student3.demoschool2@edu.in", name: "School2 Student III", admNo: "DS2LKG001", cls: "LKG", sec: "A" },
      { email: "student4.demoschool2@edu.in", name: "School2 Student IV", admNo: "DS2LKG002", cls: "LKG", sec: "A" },
    ];
    for (const s of students2) {
      const checkR = await api("GET", `/students?admissionNo=${s.admNo}`, null, token, { "X-School-Id": school2._id });
      if (checkR.ok && checkR.data.data?.length > 0) {
        console.log(`  Student record exists: ${s.admNo}`);
      } else {
        const stuR = await api("POST", "/students", {
          admissionNo: s.admNo, name: s.name, class: s.cls, section: s.sec,
          gender: "Male", contact: "9999999999", parentName: "Demo Parent",
          schoolId: school2._id, session: "2026-27",
        }, token, { "X-School-Id": school2._id });
        if (!stuR.ok) {
          console.log(`  Student record FAILED ${s.admNo}: ${stuR.data.message || JSON.stringify(stuR.data)}`);
        }
      }
      await createUserSafe(s.email, {
        email: s.email, password: PASSWORD, role: "student",
        name: s.name, schoolId: school2._id, refId: s.admNo,
      });
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`SEED COMPLETE`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`${"=".repeat(50)}`);

  // Final verification
  const final = await api("GET", "/auth/users?limit=200", null, token);
  console.log(`\nFinal user count: ${final.data.total}`);
  console.log("\nAll users:");
  (final.data.data || []).forEach((u) => {
    console.log(`  ${u.role.padEnd(15)} | ${(u.designation || "-").padEnd(25)} | ${u.email}`);
  });
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
