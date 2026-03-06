const CONFIG = {
  "environments": [
    {
      "label": "Hallpass User Api Cloud Dev",
      "baseUrl": "https://user-api-dev-509242588558.us-west1.run.app"
    },
    {
      "label": "Hallpass User Api Cloud Prod",
      "baseUrl": "https://user-api-509242588558.us-west1.run.app"
    }
  ],
  "groups": [
    {
      "name": "Auth",
      "order": 2000,
      "endpoints": [
        {
          "name": "Sign In",
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
          "name": "Sign Out",
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
        },
        {
          "name": "Sign Up",
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
        }
      ]
    },
    {
      "name": "No group",
      "order": 9999,
      "endpoints": [
        {
          "name": "Health",
          "method": "GET",
          "url": "{{Base}}/health",
          "description": "Check service health. Verifies the API is running and can reach the database.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        }
      ]
    },
    {
      "name": "User-API",
      "order": 1000,
      "endpoints": [
        {
          "name": "Batch Get User",
          "method": "GET",
          "url": "{{Base}}/api/users",
          "description": "Fetch up to 100 users by a comma-separated list of IDs. Requires TEACHER role or higher.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [
            {
              "key": "ids",
              "value": "cmmdth7vq0000k50msye6albt,cmmdth8860002k50mq6euj3zh"
            }
          ],
          "body": null
        },
        {
          "name": "Bulk Create Users",
          "method": "POST",
          "url": "{{Base}}/api/users/bulk",
          "description": "Create multiple users in one request. Requires ADMIN role or higher. Each user can have an optional role (defaults to STUDENT). Returns a summary of created and failed entries — partial success is possible.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": "[\n  { \"email\": \"student1@hallpass.dev\", \"name\": \"Student One\", \"role\": \"STUDENT\" },\n  { \"email\": \"student2@hallpass.dev\", \"name\": \"Student Two\", \"role\": \"STUDENT\" },\n  { \"email\": \"teacher1@hallpass.dev\", \"name\": \"Teacher One\", \"role\": \"TEACHER\" }\n]"
        },
        {
          "name": "Create User",
          "method": "POST",
          "url": "{{Base}}/api/users",
          "description": "Create a single user. Requires ADMIN role or higher. Cannot assign a role higher than your own. Returns 409 if the email is already in use.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": "{\n  \"email\": \"newuser@hallpass.dev\",\n  \"name\": \"New User\",\n  \"role\": \"STUDENT\"\n}"
        },
        {
          "name": "Delete User",
          "method": "DELETE",
          "url": "{{Base}}/api/users/:id",
          "description": "Soft-delete a user. Requires ADMIN role or higher. Cannot delete a user with an equal or higher role than your own. Returns 204 on success.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "cmmdth7vq0000k50msye6albt"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Get Me",
          "method": "GET",
          "url": "{{Base}}/api/users/me",
          "description": "Returns the currently authenticated user's profile. Requires an active session.",
          "headers": [],
          "pathVariables": [],
          "queryParams": [],
          "body": null
        },
        {
          "name": "Get User",
          "method": "GET",
          "url": "{{Base}}/api/users/:id",
          "description": "Get a single user by ID. Users can fetch their own profile; TEACHER role or higher can fetch any user.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "cmmdth7vq0000k50msye6albt"
            }
          ],
          "queryParams": [],
          "body": null
        },
        {
          "name": "List Users",
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
          "name": "Patch User",
          "method": "PATCH",
          "url": "{{Base}}/api/users/:id",
          "description": "Update a user's name, email, or role. Users can update their own name; ADMIN or higher required to change email or role. Cannot assign a role higher than your own.",
          "headers": [],
          "pathVariables": [
            {
              "key": "id",
              "value": "cmmdth7vq0000k50msye6albt"
            }
          ],
          "queryParams": [],
          "body": "{\n  \"name\": \"Updated Name\"\n}"
        }
      ]
    }
  ]
};
