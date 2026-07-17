// GENERATED FILE — DO NOT EDIT
const CONFIG = {
  "stages": [
    "Prod"
  ],
  "groups": [
    {
      "name": "User-API",
      "order": 1000,
      "baseUrls": {
        "Prod": "https://user-api-509242588558.us-west1.run.app"
      },
      "subgroups": null,
      "endpoints": [
        {
          "name": "Health",
          "order": 100,
          "method": "GET",
          "url": "{{Base}}/health",
          "description": "Check user-api health. Verifies the service is running and can reach the database. Run this first — services scale to zero, so the first request warms a cold instance.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Get Me",
          "order": 500,
          "method": "GET",
          "url": "{{Base}}/api/users/me",
          "description": "Returns the currently authenticated user's profile. Requires an active session.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        },
        {
          "name": "List Users",
          "order": 750,
          "method": "GET",
          "url": "{{Base}}/api/users",
          "description": "Cursor-paginated list of users. Requires TEACHER role or higher. Optional query params — role (filter by role), cursor (pagination cursor from previous response), limit (default 20, max 100).",
          "headers": [],
          "pathVariables": [],
          "queryParams": [
            {
              "key": "role",
              "value": "STUDENT"
            },
            {
              "key": "cursor",
              "value": ""
            },
            {
              "key": "limit",
              "value": "20"
            }
          ],
          "body": null
        },
        {
          "name": "Batch Get User",
          "order": 1000,
          "method": "GET",
          "url": "{{Base}}/api/users",
          "description": "Fetch up to 100 users by a comma-separated list of IDs. Requires TEACHER role or higher.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [
            {
              "key": "ids",
              "value": "1,2"
            }
          ],
          "body": null
        },
        {
          "name": "Get User",
          "order": 2000,
          "method": "GET",
          "url": "{{Base}}/api/users/:id",
          "description": "Get a single user by ID. Users can fetch their own profile; TEACHER role or higher can fetch any user.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Patch User",
          "order": 3000,
          "method": "PATCH",
          "url": "{{Base}}/api/users/:id",
          "description": "Update a user's name, email, or role. Users can update their own name; ADMIN or higher required to change email or role. Cannot assign a role higher than your own.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": "{\n  \"name\": \"Updated Name\"\n}"
        },
        {
          "name": "Delete User",
          "order": 4000,
          "method": "DELETE",
          "url": "{{Base}}/api/users/:id",
          "description": "Soft-delete a user. Requires ADMIN role or higher. Cannot delete a user with an equal or higher role than your own. Returns 204 on success.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Create User",
          "order": 5000,
          "method": "POST",
          "url": "{{Base}}/api/users",
          "description": "Create a single user. Requires ADMIN role or higher. Cannot assign a role higher than your own. Returns 409 if the email is already in use.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": "{\n  \"email\": \"newuser@hallpass.dev\",\n  \"name\": \"New User\",\n  \"role\": \"STUDENT\"\n}"
        },
        {
          "name": "Bulk Create Users",
          "order": 6000,
          "method": "POST",
          "url": "{{Base}}/api/users/bulk",
          "description": "Create multiple users in one request. Requires ADMIN role or higher. Each user can have an optional role (defaults to STUDENT). Returns a summary of created and failed entries — partial success is possible.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": "[\n  { \"email\": \"student1@hallpass.dev\", \"name\": \"Student One\", \"role\": \"STUDENT\" },\n  { \"email\": \"student2@hallpass.dev\", \"name\": \"Student Two\", \"role\": \"STUDENT\" },\n  { \"email\": \"teacher1@hallpass.dev\", \"name\": \"Teacher One\", \"role\": \"TEACHER\" }\n]"
        }
      ]
    },
    {
      "name": "Auth",
      "order": 2000,
      "baseUrls": {
        "Prod": "https://user-api-509242588558.us-west1.run.app"
      },
      "subgroups": null,
      "endpoints": [
        {
          "name": "Sign Up",
          "order": 1000,
          "method": "POST",
          "url": "{{Base}}/api/auth/sign-up/email",
          "description": "Register a new account with email and password. Returns the created user and sets a session cookie.",
          "headers": [
            {
              "key": "Origin",
              "value": "{{Base}}"
            }
          ],
          "pathVariables": [],
          "queryParams": [],
          "body": "{\n  \"email\": \"test@example.com\",\n  \"password\": \"password\",\n  \"name\": \"Test User\"\n}"
        },
        {
          "name": "Sign In",
          "order": 2000,
          "method": "POST",
          "url": "{{Base}}/api/auth/sign-in/email",
          "description": "Sign in with email and password. Sets a session cookie used by all protected endpoints. Seed accounts — student@hallpass.dev, teacher@hallpass.dev, admin@hallpass.dev, superadmin@hallpass.dev (password \"password\").",
          "headers": [
            {
              "key": "Origin",
              "value": "{{Base}}"
            }
          ],
          "pathVariables": [],
          "queryParams": [],
          "body": "{\n  \"email\": \"admin@hallpass.dev\",\n  \"password\": \"password\"\n}"
        },
        {
          "name": "Change Password",
          "order": 2500,
          "method": "POST",
          "url": "{{Base}}/api/auth/change-password",
          "description": "Change the current user's password. Requires an active session (sign in first). Set revokeOtherSessions to true to invalidate all other sessions after the change.",
          "headers": [
            {
              "key": "Origin",
              "value": "{{Base}}"
            }
          ],
          "pathVariables": [],
          "queryParams": [],
          "body": "{\n  \"currentPassword\": \"password\",\n  \"newPassword\": \"new-password\",\n  \"revokeOtherSessions\": true\n}"
        },
        {
          "name": "Sign Out",
          "order": 3000,
          "method": "POST",
          "url": "{{Base}}/api/auth/sign-out",
          "description": "Sign out the current session. Clears the session cookie.",
          "headers": [
            {
              "key": "Origin",
              "value": "{{Base}}"
            }
          ],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        }
      ]
    },
    {
      "name": "Schools-API",
      "order": 3000,
      "baseUrls": {
        "Prod": "https://schools-api-509242588558.us-west1.run.app"
      },
      "subgroups": [
        {
          "name": "Health",
          "order": 100,
          "endpoints": [
            {
              "name": "Health",
              "order": 100,
              "method": "GET",
              "url": "{{Base}}/health",
              "description": "Check schools-api health. Verifies the service is running and can reach the database. Run this first — services scale to zero, so the first request warms a cold instance.",
              "headers": [],
              "pathVariables": [],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Districts",
          "order": 1000,
          "endpoints": [
            {
              "name": "List Districts",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/districts",
              "description": "Cursor-paginated list of all districts. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [],
              "queryParams": [
                {
                  "key": "cursor",
                  "value": ""
                },
                {
                  "key": "limit",
                  "value": "50"
                }
              ],
              "body": null
            },
            {
              "name": "Create District",
              "order": 2000,
              "method": "POST",
              "url": "{{Base}}/api/districts",
              "description": "Create a new district. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [],
              "queryParams": [],
              "body": "{\n  \"name\": \"Demo District\"\n}"
            },
            {
              "name": "Get District",
              "order": 3000,
              "method": "GET",
              "url": "{{Base}}/api/districts/:id",
              "description": "Get a single district by ID. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            },
            {
              "name": "Update District",
              "order": 4000,
              "method": "PATCH",
              "url": "{{Base}}/api/districts/:id",
              "description": "Update a district's name. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Updated District Name\"\n}"
            },
            {
              "name": "Delete District",
              "order": 5000,
              "method": "DELETE",
              "url": "{{Base}}/api/districts/:id",
              "description": "Soft-delete a district. Requires SUPER_ADMIN role. Returns 204 on success.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Schools",
          "order": 2000,
          "endpoints": [
            {
              "name": "List Schools",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/schools",
              "description": "Cursor-paginated list of all schools. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [],
              "queryParams": [
                {
                  "key": "cursor",
                  "value": ""
                },
                {
                  "key": "limit",
                  "value": "50"
                }
              ],
              "body": null
            },
            {
              "name": "Create School",
              "order": 2000,
              "method": "POST",
              "url": "{{Base}}/api/schools",
              "description": "Create a new school. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [],
              "queryParams": [],
              "body": "{\n  \"name\": \"Demo High School\",\n  \"timezone\": \"America/Los_Angeles\",\n  \"districtId\": 1\n}"
            },
            {
              "name": "Get School",
              "order": 3000,
              "method": "GET",
              "url": "{{Base}}/api/schools/:id",
              "description": "Get a single school by ID. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            },
            {
              "name": "Update School",
              "order": 4000,
              "method": "PATCH",
              "url": "{{Base}}/api/schools/:id",
              "description": "Update a school's name, timezone, or districtId. Requires SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Updated School Name\"\n}"
            },
            {
              "name": "Delete School",
              "order": 5000,
              "method": "DELETE",
              "url": "{{Base}}/api/schools/:id",
              "description": "Soft-delete a school. Requires SUPER_ADMIN role. Returns 204 on success.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Schedule Types",
          "order": 3000,
          "endpoints": [
            {
              "name": "List Schedule Types",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types",
              "description": "List all schedule types for a school. Requires school membership.",
              "headers": {
                "X-Api-Key": "{{ParentToolApiKey}}"
              },
              "pathVariables": {
                "schoolId": "1"
              },
              "queryParams": {
                "cursor": "",
                "limit": "50"
              },
              "body": null
            },
            {
              "name": "Create Schedule Type",
              "order": 2000,
              "method": "POST",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types",
              "description": "Create a schedule type for a school. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Standard Day\",\n  \"startBuffer\": 15,\n  \"endBuffer\": 15\n}"
            },
            {
              "name": "Update Schedule Type",
              "order": 3000,
              "method": "PATCH",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types/:id",
              "description": "Update a schedule type's name or buffers. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Updated Schedule Name\"\n}"
            },
            {
              "name": "Delete Schedule Type",
              "order": 4000,
              "method": "DELETE",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types/:id",
              "description": "Soft-delete a schedule type. Fails with 409 if calendar entries reference it. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Periods",
          "order": 4000,
          "endpoints": [
            {
              "name": "List Periods",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types/:scheduleTypeId/periods",
              "description": "List all periods for a schedule type. Requires school membership.",
              "headers": {
                "X-Api-Key": "{{ParentToolApiKey}}"
              },
              "pathVariables": {
                "schoolId": "1",
                "scheduleTypeId": "1"
              },
              "queryParams": [],
              "body": null
            },
            {
              "name": "Create Period",
              "order": 2000,
              "method": "POST",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types/:scheduleTypeId/periods",
              "description": "Create a period within a schedule type. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "scheduleTypeId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Period 1\",\n  \"startTime\": \"08:00\",\n  \"endTime\": \"08:50\",\n  \"order\": 0\n}"
            },
            {
              "name": "Update Period",
              "order": 3000,
              "method": "PATCH",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types/:scheduleTypeId/periods/:id",
              "description": "Update a period's name, times, or order. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "scheduleTypeId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Updated Period Name\"\n}"
            },
            {
              "name": "Delete Period",
              "order": 4000,
              "method": "DELETE",
              "url": "{{Base}}/api/schools/:schoolId/schedule-types/:scheduleTypeId/periods/:id",
              "description": "Soft-delete a period. Requires ADMIN or SUPER_ADMIN role. Returns 204 on success.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "scheduleTypeId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Calendar",
          "order": 5000,
          "endpoints": [
            {
              "name": "List Calendar",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/schools/:schoolId/calendar",
              "description": "List calendar entries for a school, optionally filtered by date range. Requires school membership.",
              "headers": {
                "X-Api-Key": "{{ParentToolApiKey}}"
              },
              "pathVariables": {
                "schoolId": "1"
              },
              "queryParams": {
                "from": "",
                "to": ""
              },
              "body": null
            },
            {
              "name": "Upsert Calendar Entries",
              "order": 2000,
              "method": "POST",
              "url": "{{Base}}/api/schools/:schoolId/calendar",
              "description": "Bulk upsert calendar entries by date. Accepts a single entry or array. Returns counts of created and updated entries. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "[\n  { \"date\": \"2026-03-11\", \"scheduleTypeId\": 1, \"note\": null },\n  { \"date\": \"2026-03-12\", \"scheduleTypeId\": 2, \"note\": \"Late Start Wednesday\" }\n]"
            },
            {
              "name": "Update Calendar Entry",
              "order": 3000,
              "method": "PATCH",
              "url": "{{Base}}/api/schools/:schoolId/calendar/:id",
              "description": "Update a calendar entry's schedule type or note. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"scheduleTypeId\": 1,\n  \"note\": \"Updated note\"\n}"
            },
            {
              "name": "Delete Calendar Entry",
              "order": 4000,
              "method": "DELETE",
              "url": "{{Base}}/api/schools/:schoolId/calendar/:id",
              "description": "Hard-delete a calendar entry. Requires ADMIN or SUPER_ADMIN role. Returns 204 on success.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Destinations",
          "order": 6000,
          "endpoints": [
            {
              "name": "List Destinations",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/schools/:schoolId/destinations",
              "description": "List all destinations for a school. Requires school membership.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            },
            {
              "name": "Create Destination",
              "order": 2000,
              "method": "POST",
              "url": "{{Base}}/api/schools/:schoolId/destinations",
              "description": "Create a destination for a school. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Library\",\n  \"maxOccupancy\": 20\n}"
            },
            {
              "name": "Update Destination",
              "order": 3000,
              "method": "PATCH",
              "url": "{{Base}}/api/schools/:schoolId/destinations/:id",
              "description": "Update a destination's name or max occupancy. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"name\": \"Updated Destination\"\n}"
            },
            {
              "name": "Delete Destination",
              "order": 4000,
              "method": "DELETE",
              "url": "{{Base}}/api/schools/:schoolId/destinations/:id",
              "description": "Soft-delete a destination. Requires ADMIN or SUPER_ADMIN role. Returns 204 on success.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                },
                {
                  "key": "id",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            }
          ]
        },
        {
          "name": "Policy",
          "order": 7000,
          "endpoints": [
            {
              "name": "Get Policy",
              "order": 1000,
              "method": "GET",
              "url": "{{Base}}/api/schools/:schoolId/policy",
              "description": "Get the pass policy for a school. Returns 404 if no policy has been set. Requires school membership.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": null
            },
            {
              "name": "Upsert Policy",
              "order": 2000,
              "method": "PUT",
              "url": "{{Base}}/api/schools/:schoolId/policy",
              "description": "Create or replace the pass policy for a school. All fields are optional — omitting them clears the policy. interval and maxPerInterval must both be set or both omitted. Requires ADMIN or SUPER_ADMIN role.",
              "headers": [],
              "pathVariables": [
                {
                  "key": "schoolId",
                  "value": "1"
                }
              ],
              "queryParams": [],
              "body": "{\n  \"maxActivePasses\": 3,\n  \"interval\": \"DAY\",\n  \"maxPerInterval\": 5\n}"
            }
          ]
        }
      ],
      "endpoints": []
    },
    {
      "name": "Passes-API",
      "order": 4000,
      "baseUrls": {
        "Prod": "https://passes-api-509242588558.us-west1.run.app"
      },
      "subgroups": null,
      "endpoints": [
        {
          "name": "Health",
          "order": 100,
          "method": "GET",
          "url": "{{Base}}/health",
          "description": "Check passes-api health. Verifies the service is running and can reach the database. Run this first — services scale to zero, so the first request warms a cold instance.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Create Pass",
          "order": 1000,
          "method": "POST",
          "url": "{{Base}}/api/passes",
          "description": "Create a pass. Students create their own (studentId omitted, status PENDING). TEACHER+ must supply studentId; the pass is auto-approved to ACTIVE, or WAITING when the destination or school cap is full. 201 created, 409 student already has a non-terminal pass, 422 validation/no period.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": "{\n  \"destinationId\": 1,\n  \"studentId\": 1,\n  \"note\": \"restroom\"\n}"
        },
        {
          "name": "List Passes",
          "order": 2000,
          "method": "GET",
          "url": "{{Base}}/api/passes",
          "description": "Cursor-paginated list of passes. Students see only their own; TEACHER+ see all passes in their school. Optional query params — status (PENDING/ACTIVE/WAITING/COMPLETED/CANCELLED/DENIED/EXPIRED), cursor (pagination cursor from previous response), limit (default 50, max 100).",
          "headers": [],
          "pathVariables": [],
          "queryParams": [
            {
              "key": "status",
              "value": "ACTIVE"
            },
            {
              "key": "cursor",
              "value": ""
            },
            {
              "key": "limit",
              "value": "50"
            }
          ],
          "body": null
        },
        {
          "name": "Get Pass",
          "order": 3000,
          "method": "GET",
          "url": "{{Base}}/api/passes/:id",
          "description": "Get a single pass by ID. Students can only fetch their own passes; TEACHER+ any pass in their school. 404 when not found or not visible.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Approve Pass",
          "order": 4000,
          "method": "POST",
          "url": "{{Base}}/api/passes/:id/approve",
          "description": "Approve a PENDING pass. Requires TEACHER role or higher. Transitions to ACTIVE, or WAITING when the destination or school cap is full. 400 not PENDING, 409 lost race.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": "{\n  \"approverNote\": \"\"\n}"
        },
        {
          "name": "Deny Pass",
          "order": 5000,
          "method": "POST",
          "url": "{{Base}}/api/passes/:id/deny",
          "description": "Deny a PENDING pass. Requires TEACHER role or higher. 400 not PENDING, 409 lost race.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": "{\n  \"denierNote\": \"\"\n}"
        },
        {
          "name": "Return Pass",
          "order": 6000,
          "method": "POST",
          "url": "{{Base}}/api/passes/:id/return",
          "description": "Return an ACTIVE pass (student comes back). Students can return their own; TEACHER+ any pass in their school. Frees the slot and promotes the oldest WAITING pass. 400 not ACTIVE, 409 lost race.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Cancel Pass",
          "order": 7000,
          "method": "POST",
          "url": "{{Base}}/api/passes/:id/cancel",
          "description": "Cancel a PENDING or WAITING pass. Students can cancel their own; TEACHER+ any pass in their school. 400 not PENDING/WAITING, 409 lost race.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "1"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Reconcile Expiry",
          "order": 8000,
          "method": "POST",
          "url": "{{Base}}/internal/reconcile-expiry",
          "description": "Internal recovery/heartbeat endpoint normally hit by Cloud Scheduler. Re-arms lost expiry jobs, reconciles slot counters, and promotes from the queue. Auth is a bearer INTERNAL_SECRET, not a session — set InternalSecret in the environment. Returns {scheduled, reconciled}; 207 on partial errors.",
          "headers": [
            {
              "key": "Authorization",
              "value": "Bearer {{InternalSecret}}"
            }
          ],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Parent Lookup",
          "order": 9000,
          "method": "GET",
          "url": "{{Base}}/api/passes/parent-lookup",
          "description": "External voice-AI parent tool endpoint. Looks up a student by PIN and returns their pass history. Auth is an X-Api-Key header (PARENT_TOOL_API_KEY), not a session — set ParentToolApiKey in the environment. Rate-limited by IP to throttle PIN guessing. Query params — pin (required, the student's PIN), cursor (pagination cursor from previous response), limit (default 50, max 100). Returns {student, passes, nextCursor}; 400 missing pin, 401 bad key, 404 no student matches the pin, 429 too many attempts.",
          "headers": {
            "X-Api-Key": "{{ParentToolApiKey}}"
          },
          "pathVariables": [],
          "queryParams": [
            {
              "key": "pin",
              "value": "482913",
              "disabled": false,
              "description": ""
            },
            {
              "key": "cursor",
              "value": "",
              "disabled": false,
              "description": ""
            },
            {
              "key": "limit",
              "value": "50",
              "disabled": false,
              "description": ""
            }
          ],
          "body": null
        }
      ]
    }
  ]
};
