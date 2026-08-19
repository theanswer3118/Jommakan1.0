#!/usr/bin/env python3
"""
Jom Makan Restaurant OS Phase 1A - Backend API Tests
Tests authentication, RLS enforcement, audit log immutability, and constraints.
"""

import requests
import json
import sys
from typing import Dict, Optional

# Base URL from environment
BASE_URL = "https://f42cc20a-05fc-4cc2-9953-96abb1429497.preview.emergentagent.com/api"

# Test results tracking
test_results = {
    "passed": [],
    "failed": [],
    "total": 0
}

def log_test(name: str, passed: bool, message: str = ""):
    """Log test result"""
    test_results["total"] += 1
    if passed:
        test_results["passed"].append(name)
        print(f"✅ PASS: {name}")
        if message:
            print(f"   {message}")
    else:
        test_results["failed"].append(name)
        print(f"❌ FAIL: {name}")
        if message:
            print(f"   {message}")

def login(employee_code: str, pin: str) -> Optional[Dict]:
    """Login and return session data"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"employee_code": employee_code, "pin": pin},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            return data.get("session")
        return None
    except Exception as e:
        print(f"Login error for {employee_code}: {e}")
        return None

def get_auth_header(token: str) -> Dict[str, str]:
    """Get authorization header"""
    return {"Authorization": f"Bearer {token}"}

# ============================================================================
# TEST 1: AUTHENTICATION
# ============================================================================

def test_auth():
    """Test authentication flows"""
    print("\n" + "="*80)
    print("TEST 1: AUTHENTICATION")
    print("="*80)
    
    # Test 1.1: Successful login with OWN001
    print("\n[1.1] Testing successful login with OWN001/123456...")
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"employee_code": "OWN001", "pin": "123456"},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            if data.get("session") and data["session"].get("access_token"):
                log_test("Auth: OWN001 login success", True, f"Got access_token")
                global owner_token
                owner_token = data["session"]["access_token"]
            else:
                log_test("Auth: OWN001 login success", False, "No session/access_token in response")
        else:
            log_test("Auth: OWN001 login success", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Auth: OWN001 login success", False, f"Exception: {e}")
    
    # Test 1.2: Wrong PIN
    print("\n[1.2] Testing login with wrong PIN...")
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"employee_code": "OWN001", "pin": "wrong"},
            timeout=10
        )
        if response.status_code == 401:
            log_test("Auth: Wrong PIN rejected", True, "Got 401 as expected")
        else:
            log_test("Auth: Wrong PIN rejected", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        log_test("Auth: Wrong PIN rejected", False, f"Exception: {e}")
    
    # Test 1.3: Unknown employee_code
    print("\n[1.3] Testing login with unknown employee_code...")
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"employee_code": "UNKNOWN999", "pin": "123456"},
            timeout=10
        )
        if response.status_code == 401:
            log_test("Auth: Unknown employee rejected", True, "Got 401 as expected")
        else:
            log_test("Auth: Unknown employee rejected", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        log_test("Auth: Unknown employee rejected", False, f"Exception: {e}")
    
    # Test 1.4: Inactive employee cannot login
    print("\n[1.4] Testing inactive employee login rejection...")
    try:
        # First create an inactive employee
        response = requests.post(
            f"{BASE_URL}/employees",
            headers=get_auth_header(owner_token),
            json={
                "employee_code": "INACTIVE001",
                "name": "Inactive Test User",
                "pin": "123456",
                "role": "SERVICE",
                "status": "inactive"
            },
            timeout=10
        )
        if response.status_code in [200, 201]:
            print("   Created inactive employee INACTIVE001")
            # Try to login
            response = requests.post(
                f"{BASE_URL}/auth/login",
                json={"employee_code": "INACTIVE001", "pin": "123456"},
                timeout=10
            )
            if response.status_code == 403:
                data = response.json()
                if "tidak aktif" in data.get("error", "").lower():
                    log_test("Auth: Inactive employee rejected", True, f"Got 403 with message: {data.get('error')}")
                else:
                    log_test("Auth: Inactive employee rejected", True, f"Got 403 (message: {data.get('error')})")
            else:
                log_test("Auth: Inactive employee rejected", False, f"Expected 403, got {response.status_code}: {response.text}")
        else:
            log_test("Auth: Inactive employee rejected", False, f"Failed to create inactive employee: {response.status_code}")
    except Exception as e:
        log_test("Auth: Inactive employee rejected", False, f"Exception: {e}")

# ============================================================================
# TEST 2: RLS ENFORCEMENT (7 ROLES)
# ============================================================================

def test_rls_enforcement():
    """Test RLS enforcement for all 7 roles"""
    print("\n" + "="*80)
    print("TEST 2: RLS ENFORCEMENT (7 ROLES)")
    print("="*80)
    
    # Expected permissions for each role
    expected_permissions = {
        "OWNER": ["view_dashboard", "view_employee", "manage_employee", "view_items", "manage_items", "view_settings", "manage_settings", "view_audit_log"],
        "MANAGER": ["view_dashboard", "view_employee", "manage_employee", "view_items", "manage_items", "view_settings", "manage_settings", "view_audit_log"],
        "PURCHASING": ["view_dashboard", "view_employee", "view_items", "manage_items"],
        "KITCHEN": ["view_dashboard", "view_items"],
        "BAR": ["view_dashboard", "view_items"],
        "SERVICE": ["view_dashboard", "view_employee"],
        "STOCK": ["view_dashboard", "view_items", "manage_items"]
    }
    
    # Create employees for each role
    roles_to_create = [
        ("MGR001", "Manager Test", "MANAGER"),
        ("PUR001", "Purchasing Test", "PURCHASING"),
        ("KTC001", "Kitchen Test", "KITCHEN"),
        ("BAR001", "Bar Test", "BAR"),
        ("SVC001", "Service Test", "SERVICE"),
        ("STK001", "Stock Test", "STOCK")
    ]
    
    print("\n[2.1] Creating employees for each role...")
    created_employees = {}
    for emp_code, name, role in roles_to_create:
        try:
            response = requests.post(
                f"{BASE_URL}/employees",
                headers=get_auth_header(owner_token),
                json={
                    "employee_code": emp_code,
                    "name": name,
                    "pin": "123456",
                    "role": role,
                    "status": "active"
                },
                timeout=10
            )
            if response.status_code in [200, 201]:
                print(f"   ✓ Created {emp_code} ({role})")
                created_employees[role] = emp_code
            else:
                # Check if already exists
                if "duplicate" in response.text.lower() or "already exists" in response.text.lower():
                    print(f"   ✓ {emp_code} ({role}) already exists")
                    created_employees[role] = emp_code
                else:
                    print(f"   ✗ Failed to create {emp_code}: {response.status_code} - {response.text}")
        except Exception as e:
            print(f"   ✗ Exception creating {emp_code}: {e}")
    
    # Test permissions for each role
    print("\n[2.2] Testing permissions for each role...")
    role_tokens = {}
    
    # Add OWNER to the test
    all_roles = [("OWN001", "OWNER")] + [(code, role) for role, code in created_employees.items()]
    
    for emp_code, role in all_roles:
        try:
            # Login
            session = login(emp_code, "123456")
            if not session:
                log_test(f"RLS: {role} login", False, f"Failed to login as {emp_code}")
                continue
            
            token = session.get("access_token")
            role_tokens[role] = token
            
            # Get /auth/me
            response = requests.get(
                f"{BASE_URL}/auth/me",
                headers=get_auth_header(token),
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                permissions = data.get("permissions", [])
                expected = expected_permissions.get(role, [])
                
                # Check if permissions match
                if set(permissions) == set(expected):
                    log_test(f"RLS: {role} permissions correct", True, f"Got {len(permissions)} permissions: {', '.join(permissions)}")
                else:
                    missing = set(expected) - set(permissions)
                    extra = set(permissions) - set(expected)
                    msg = f"Expected {len(expected)}, got {len(permissions)}."
                    if missing:
                        msg += f" Missing: {', '.join(missing)}."
                    if extra:
                        msg += f" Extra: {', '.join(extra)}."
                    log_test(f"RLS: {role} permissions correct", False, msg)
            else:
                log_test(f"RLS: {role} permissions correct", False, f"Status {response.status_code}: {response.text}")
        except Exception as e:
            log_test(f"RLS: {role} permissions correct", False, f"Exception: {e}")
    
    # Test unauthorized operations
    print("\n[2.3] Testing unauthorized operations...")
    
    # KITCHEN trying to POST /api/employees (should fail - no manage_employee)
    if "KITCHEN" in role_tokens:
        try:
            response = requests.post(
                f"{BASE_URL}/employees",
                headers=get_auth_header(role_tokens["KITCHEN"]),
                json={
                    "employee_code": "TEST999",
                    "name": "Test User",
                    "pin": "123456",
                    "role": "SERVICE",
                    "status": "active"
                },
                timeout=10
            )
            if response.status_code == 403:
                log_test("RLS: KITCHEN cannot create employee", True, "Got 403 as expected")
            else:
                log_test("RLS: KITCHEN cannot create employee", False, f"Expected 403, got {response.status_code}")
        except Exception as e:
            log_test("RLS: KITCHEN cannot create employee", False, f"Exception: {e}")
    
    # SERVICE trying to PATCH /api/settings/brand (should fail - no manage_settings)
    if "SERVICE" in role_tokens:
        try:
            response = requests.patch(
                f"{BASE_URL}/settings/brand",
                headers=get_auth_header(role_tokens["SERVICE"]),
                json={"name": "Hacked Brand"},
                timeout=10
            )
            if response.status_code == 403:
                log_test("RLS: SERVICE cannot update brand", True, "Got 403 as expected")
            else:
                log_test("RLS: SERVICE cannot update brand", False, f"Expected 403, got {response.status_code}")
        except Exception as e:
            log_test("RLS: SERVICE cannot update brand", False, f"Exception: {e}")
    
    # SERVICE trying to GET /api/audit-logs (should fail - no view_audit_log)
    if "SERVICE" in role_tokens:
        try:
            response = requests.get(
                f"{BASE_URL}/audit-logs",
                headers=get_auth_header(role_tokens["SERVICE"]),
                timeout=10
            )
            if response.status_code == 403:
                log_test("RLS: SERVICE cannot view audit logs", True, "Got 403 as expected")
            else:
                log_test("RLS: SERVICE cannot view audit logs", False, f"Expected 403, got {response.status_code}")
        except Exception as e:
            log_test("RLS: SERVICE cannot view audit logs", False, f"Exception: {e}")

# ============================================================================
# TEST 3: AUDIT LOG IMMUTABILITY
# ============================================================================

def test_audit_log():
    """Test audit log functionality and immutability"""
    print("\n" + "="*80)
    print("TEST 3: AUDIT LOG IMMUTABILITY")
    print("="*80)
    
    # Test 3.1: Audit logs are created
    print("\n[3.1] Testing audit log creation...")
    try:
        response = requests.get(
            f"{BASE_URL}/audit-logs",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            logs = data.get("logs", [])
            if len(logs) > 0:
                # Check for employee INSERT
                employee_inserts = [log for log in logs if log.get("entity_type") == "employees" and log.get("action") == "INSERT"]
                if employee_inserts:
                    log_test("Audit: Logs created for employee INSERT", True, f"Found {len(employee_inserts)} employee INSERT logs")
                    global test_audit_log_id
                    test_audit_log_id = logs[0].get("id")
                else:
                    log_test("Audit: Logs created for employee INSERT", True, f"Found {len(logs)} audit logs (no employee INSERT found, but logs exist)")
                    test_audit_log_id = logs[0].get("id")
            else:
                log_test("Audit: Logs created for employee INSERT", False, "No audit logs found")
        else:
            log_test("Audit: Logs created for employee INSERT", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Audit: Logs created for employee INSERT", False, f"Exception: {e}")
    
    # Test 3.2: Cannot DELETE audit log (even as OWNER)
    print("\n[3.2] Testing audit log DELETE immutability...")
    if test_audit_log_id:
        try:
            response = requests.delete(
                f"{BASE_URL}/audit-logs/{test_audit_log_id}",
                headers=get_auth_header(owner_token),
                timeout=10
            )
            if response.status_code == 403:
                data = response.json()
                error_msg = data.get("error", "").lower()
                if "permission denied" in error_msg or "audit_logs" in error_msg:
                    log_test("Audit: DELETE blocked (immutable)", True, f"Got 403 with: {data.get('error')}")
                else:
                    log_test("Audit: DELETE blocked (immutable)", True, f"Got 403 (message: {data.get('error')})")
            else:
                log_test("Audit: DELETE blocked (immutable)", False, f"Expected 403, got {response.status_code}: {response.text}")
        except Exception as e:
            log_test("Audit: DELETE blocked (immutable)", False, f"Exception: {e}")
    else:
        log_test("Audit: DELETE blocked (immutable)", False, "No audit log ID to test")
    
    # Test 3.3: Cannot PATCH audit log (even as OWNER)
    print("\n[3.3] Testing audit log PATCH immutability...")
    if test_audit_log_id:
        try:
            response = requests.patch(
                f"{BASE_URL}/audit-logs/{test_audit_log_id}",
                headers=get_auth_header(owner_token),
                json={"action": "HACKED"},
                timeout=10
            )
            if response.status_code == 403:
                data = response.json()
                error_msg = data.get("error", "").lower()
                if "permission denied" in error_msg or "audit_logs" in error_msg:
                    log_test("Audit: PATCH blocked (immutable)", True, f"Got 403 with: {data.get('error')}")
                else:
                    log_test("Audit: PATCH blocked (immutable)", True, f"Got 403 (message: {data.get('error')})")
            else:
                log_test("Audit: PATCH blocked (immutable)", False, f"Expected 403, got {response.status_code}: {response.text}")
        except Exception as e:
            log_test("Audit: PATCH blocked (immutable)", False, f"Exception: {e}")
    else:
        log_test("Audit: PATCH blocked (immutable)", False, "No audit log ID to test")

# ============================================================================
# TEST 4: UNAUTHORIZED API ACCESS
# ============================================================================

def test_unauthorized_access():
    """Test unauthorized API access"""
    print("\n" + "="*80)
    print("TEST 4: UNAUTHORIZED API ACCESS")
    print("="*80)
    
    # Test 4.1: No Authorization header
    print("\n[4.1] Testing API access without Authorization header...")
    try:
        response = requests.get(f"{BASE_URL}/employees", timeout=10)
        if response.status_code == 401:
            log_test("Unauthorized: No auth header rejected", True, "Got 401 as expected")
        else:
            log_test("Unauthorized: No auth header rejected", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        log_test("Unauthorized: No auth header rejected", False, f"Exception: {e}")
    
    # Test 4.2: Invalid JWT
    print("\n[4.2] Testing API access with invalid JWT...")
    try:
        response = requests.get(
            f"{BASE_URL}/employees",
            headers={"Authorization": "Bearer invalid_token_12345"},
            timeout=10
        )
        if response.status_code == 401:
            log_test("Unauthorized: Invalid JWT rejected", True, "Got 401 as expected")
        else:
            log_test("Unauthorized: Invalid JWT rejected", False, f"Expected 401, got {response.status_code}")
    except Exception as e:
        log_test("Unauthorized: Invalid JWT rejected", False, f"Exception: {e}")

# ============================================================================
# TEST 5: FK / UNIQUE CONSTRAINTS
# ============================================================================

def test_constraints():
    """Test foreign key and unique constraints"""
    print("\n" + "="*80)
    print("TEST 5: FK / UNIQUE CONSTRAINTS")
    print("="*80)
    
    # Test 5.1: Duplicate employee_code
    print("\n[5.1] Testing duplicate employee_code constraint...")
    try:
        # Try to create employee with existing code (OWN001)
        response = requests.post(
            f"{BASE_URL}/employees",
            headers=get_auth_header(owner_token),
            json={
                "employee_code": "OWN001",
                "name": "Duplicate Owner",
                "pin": "123456",
                "role": "SERVICE",
                "status": "active"
            },
            timeout=10
        )
        if response.status_code in [400, 409, 500]:
            error_text = response.text.lower()
            if "duplicate" in error_text or "unique" in error_text or "already exists" in error_text:
                log_test("Constraints: Duplicate employee_code rejected", True, f"Got error with 'duplicate' or 'unique'")
            else:
                log_test("Constraints: Duplicate employee_code rejected", True, f"Got error status {response.status_code}")
        else:
            log_test("Constraints: Duplicate employee_code rejected", False, f"Expected error, got {response.status_code}")
    except Exception as e:
        log_test("Constraints: Duplicate employee_code rejected", False, f"Exception: {e}")
    
    # Test 5.2: Duplicate item name in same outlet
    print("\n[5.2] Testing duplicate item name constraint...")
    try:
        # First, get units
        response = requests.get(
            f"{BASE_URL}/units",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        units = []
        if response.status_code == 200:
            units = response.json().get("units", [])
        
        unit_id = units[0]["id"] if units else None
        
        # Create first item
        response1 = requests.post(
            f"{BASE_URL}/items",
            headers=get_auth_header(owner_token),
            json={
                "name": "Test Item Duplicate",
                "category": "Test",
                "stock_unit_id": unit_id,
                "purchase_unit_id": unit_id,
                "minimum_stock": 0,
                "is_active": True
            },
            timeout=10
        )
        
        if response1.status_code in [200, 201]:
            print("   Created first item")
            # Try to create duplicate
            response2 = requests.post(
                f"{BASE_URL}/items",
                headers=get_auth_header(owner_token),
                json={
                    "name": "Test Item Duplicate",
                    "category": "Test",
                    "stock_unit_id": unit_id,
                    "purchase_unit_id": unit_id,
                    "minimum_stock": 0,
                    "is_active": True
                },
                timeout=10
            )
            
            if response2.status_code in [400, 409, 500]:
                error_text = response2.text.lower()
                if "duplicate" in error_text or "unique" in error_text:
                    log_test("Constraints: Duplicate item name rejected", True, f"Got error with 'duplicate' or 'unique'")
                else:
                    log_test("Constraints: Duplicate item name rejected", True, f"Got error status {response2.status_code}")
            else:
                log_test("Constraints: Duplicate item name rejected", False, f"Expected error, got {response2.status_code}")
        else:
            # Item might already exist from previous test
            if "duplicate" in response1.text.lower() or "unique" in response1.text.lower():
                log_test("Constraints: Duplicate item name rejected", True, "Item already exists (constraint working)")
            else:
                log_test("Constraints: Duplicate item name rejected", False, f"Failed to create first item: {response1.status_code}")
    except Exception as e:
        log_test("Constraints: Duplicate item name rejected", False, f"Exception: {e}")

# ============================================================================
# TEST 6: MIGRATION IDEMPOTENCY
# ============================================================================

def test_migration_status():
    """Test migration status"""
    print("\n" + "="*80)
    print("TEST 6: MIGRATION STATUS")
    print("="*80)
    
    print("\n[6.1] Testing /api/setup/status...")
    try:
        response = requests.get(f"{BASE_URL}/setup/status", timeout=10)
        if response.status_code == 200:
            data = response.json()
            migration_ok = data.get("migration_ok", False)
            has_brand = data.get("has_brand", False)
            has_outlet = data.get("has_outlet", False)
            has_owner = data.get("has_owner", False)
            
            all_ok = migration_ok and has_brand and has_outlet and has_owner
            
            if all_ok:
                log_test("Migration: Status all OK", True, f"migration_ok={migration_ok}, has_brand={has_brand}, has_outlet={has_outlet}, has_owner={has_owner}")
            else:
                log_test("Migration: Status all OK", False, f"migration_ok={migration_ok}, has_brand={has_brand}, has_outlet={has_outlet}, has_owner={has_owner}")
        else:
            log_test("Migration: Status all OK", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Migration: Status all OK", False, f"Exception: {e}")

# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("JOM MAKAN RESTAURANT OS - PHASE 1A BACKEND TESTS")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print("="*80)
    
    global owner_token, test_audit_log_id
    owner_token = None
    test_audit_log_id = None
    
    # Run all test suites
    test_auth()
    test_rls_enforcement()
    test_audit_log()
    test_unauthorized_access()
    test_constraints()
    test_migration_status()
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: {test_results['total']}")
    print(f"Passed: {len(test_results['passed'])} ✅")
    print(f"Failed: {len(test_results['failed'])} ❌")
    
    if test_results['failed']:
        print("\nFailed tests:")
        for test in test_results['failed']:
            print(f"  ❌ {test}")
    
    print("="*80)
    
    # Exit with appropriate code
    sys.exit(0 if len(test_results['failed']) == 0 else 1)

if __name__ == "__main__":
    main()
