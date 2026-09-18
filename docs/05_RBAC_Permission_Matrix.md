# RBAC & PERMISSION MATRIX

## Roles
Admin = full authorised company scope.
Manager = explicit operational permissions.
Sub-manager = explicit restricted permissions.
Customer = own customer capabilities.

| Permission | Admin | Manager | Sub-manager | Customer |
|---|---|---|---|---|
| booking.view | Yes | Assign | Assign | Own |
| booking.create_manual | Yes | Assign | Assign | No |
| booking.cancel | Yes | Assign | Assign | Request |
| booking.complete | Yes | Assign | Assign | No |
| customer.view | Yes | Assign | Assign | Own |
| customer.manage | Yes | Assign | Assign | No |
| payment.view | Yes | Assign | Assign | No |
| payment.approve | Yes | Assign | Explicit | No |
| payment.record_balance | Yes | Assign | Explicit | No |
| field.view | Yes | Assign | Assign | Availability |
| field.manage | Yes | Assign | Assign | No |
| pricing.manage | Yes | Explicit | Explicit | No |
| staff.manage | Yes | Explicit | No | No |
| reports.view | Yes | Assign | Explicit | No |
| settings.manage | Yes | Explicit | No | No |
| audit.view | Yes | Explicit | No | No |
| notification.view | Yes | Assign | Assign | Own |
| notification.retry | Yes | Explicit | No | No |

Membership scope may be company-wide or venue-specific. API and RLS enforce both permission and scope.
