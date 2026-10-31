# Access policy table (Nimbus Labs)

Machine-readable version of the rules in the Access Control Policy (doc 04) and the role templates in `people_and_roles.md`. Rule of thumb: low risk is auto-approved if the role allows it; medium risk needs the requester's manager; high risk needs the Engineering Manager. Production grants are just-in-time, 8 hours maximum.

| App | Risk level | Roles allowed | Approver | Notes |
| --- | --- | --- | --- | --- |
| Slack | Low | Founder, Engineering Manager, Engineer, Intern | Auto | Default for everyone |
| Google Workspace | Low | Founder, Engineering Manager, Engineer, Intern | Auto | Default for everyone |
| Figma | Low | Founder, Engineering Manager, Engineer, Intern | Auto | Auto-approved |
| Jira | Low | Founder, Engineering Manager, Engineer | Auto | Not in the Intern template |
| GitHub | Medium | Founder, Engineering Manager, Engineer, Intern | Requester's manager | Interns get read-only |
| Datadog | Medium | Founder, Engineering Manager, Engineer | Requester's manager | Log and metrics viewer |
| Payroll tool | High | Founder | Riya Sharma | Founder only |
| AWS production | High | Founder, Engineering Manager, Engineer | Karan Malhotra (Engineering Manager) | Just-in-time, max 8 hours. Interns are not eligible. A request from Karan himself goes to Riya |

## Approvers by person
| Requester | Manager (medium-risk approver) | High-risk approver |
| --- | --- | --- |
| Meera Iyer | Karan Malhotra | Karan Malhotra |
| Arjun Verma | Karan Malhotra | Not eligible for production |
| Karan Malhotra | Riya Sharma | Riya Sharma |
| Riya Sharma | none | none |
