# ETL Transformations Documentation

This document captures the data transformations performed by the existing ETL migration jobs. This will serve as a reference for implementing equivalent AWS Glue jobs that process AppFlow-extracted data from S3.

## Table of Contents
- [Overview](#overview)
- [Account & App Configuration Transformations](#account--app-configuration-transformations)
- [Identity Transformations](#identity-transformations)
- [Content Transformations](#content-transformations)
- [Feed Transformations](#feed-transformations)
- [Native Video Transformations](#native-video-transformations)
- [Common Transformation Patterns](#common-transformation-patterns)

---

## Overview

### Source Data Architecture
- **Salesforce Objects**: Extracted via current CDC process, will be replaced with AppFlow → S3
- **PostgreSQL/Odin**: CDC replica database containing historical Salesforce data
- **Target**: Zeus DB (multi-schema PostgreSQL)

### Transformation Pipeline
```
Salesforce/Odin (PostgreSQL) → Extract → Transform → Zeus DB
                ↓
        (Future: AppFlow → S3)
```

### Key Schemas in Zeus DB
- `account_app`: Application configuration, segments, feature flags
- `identity_mgmt`: Users, profiles, expertise, audiences
- `content_mgmt`: Content, sites, pages, files, subscriptions
- `recognition`: Recognition and badges
- `content_moderation`: Moderation data

---

## Account & App Configuration Transformations

**ETL Job**: `account-app-migration-etl-job`

### Entity: ps-app-config (App Configuration)

**Source**: `Simpplr__App_Config__c` (Salesforce)

**Target**: `account_app.app_configs`

**Transformation Logic**:
```typescript
// Extract from Salesforce CDC
SELECT
  Id,
  Name,
  Simpplr__Settings__c,        // JSON configuration
  Simpplr__Type__c,
  Simpplr__Is_Deleted__c,
  CreatedDate,
  LastModifiedDate
FROM Simpplr__App_Config__c
WHERE Simpplr__Is_Deleted__c = false

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  settings: JSON.parse(salesforce.Simpplr__Settings__c),
  type: salesforce.Simpplr__Type__c,
  tenant_id: context.tenantId,
  created_at: salesforce.CreatedDate,
  updated_at: salesforce.LastModifiedDate,
  is_deleted: false
}
```

**Business Rules**:
- Parse JSON settings field
- Generate internal UUID for Zeus DB
- Map Salesforce ID to `external_id` field
- Filter out soft-deleted records

---

### Entity: ps-app-default (App Defaults)

**Source**: `Simpplr__App_Default__c` (Salesforce)

**Target**: `account_app.app_defaults`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Default_Value__c,
  Simpplr__Feature_Name__c,
  Simpplr__Is_Active__c
FROM Simpplr__App_Default__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  feature_name: salesforce.Simpplr__Feature_Name__c,
  default_value: salesforce.Simpplr__Default_Value__c,
  is_active: salesforce.Simpplr__Is_Active__c,
  tenant_id: context.tenantId
}
```

---

### Entity: ps-segments (Segments)

**Source**: `Simpplr__Segment__c` (Salesforce)

**Target**: `account_app.segments`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Criteria__c,         // JSON criteria
  Simpplr__Is_Active__c,
  Simpplr__Segment_Type__c,
  CreatedById,
  CreatedDate
FROM Simpplr__Segment__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  criteria: JSON.parse(salesforce.Simpplr__Criteria__c),
  segment_type: salesforce.Simpplr__Segment_Type__c,
  is_active: salesforce.Simpplr__Is_Active__c,
  created_by: lookupUserId(salesforce.CreatedById),
  created_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}
```

**Data Enrichment**:
- Lookup `created_by` user ID from `identity_mgmt.users` table
- Parse JSON criteria

---

### Entity: ps-ff-sync (Feature Flag Sync)

**Source**: `sfLma__License__c`, `sfFma__Feature_Parameter_*` (Salesforce LMA)

**Target**: `account_app.feature_flags`

**Transformation Logic**:
```typescript
// Extract - Join multiple LMA tables
SELECT
  l.Id as LicenseId,
  l.sfLma__Package__c,
  fb.sfFma__Name__c as BoolFeatureName,
  fb.sfFma__Value__c as BoolFeatureValue,
  fd.sfFma__Name__c as DateFeatureName,
  fd.sfFma__Value__c as DateFeatureValue,
  fi.sfFma__Name__c as IntFeatureName,
  fi.sfFma__Value__c as IntFeatureValue
FROM sfLma__License__c l
LEFT JOIN sfFma__Feature_Parameter_Booleans__r fb ON l.Id = fb.sfLma__License__c
LEFT JOIN sfFma__Feature_Parameter_Dates__r fd ON l.Id = fd.sfLma__License__c
LEFT JOIN sfFma__Feature_Parameter_Integers__r fi ON l.Id = fi.sfLma__License__c

// Transform - Normalize into key-value pairs
const features = [];
if (boolFeatures) {
  boolFeatures.forEach(f => {
    features.push({
      id: generateUUID(),
      feature_name: f.name,
      feature_value: f.value.toString(),
      feature_type: 'boolean',
      tenant_id: context.tenantId
    });
  });
}
// Similar for date and integer features
```

**Business Rules**:
- Aggregate multiple LMA feature tables
- Normalize into single feature_flags table
- Type conversion (boolean, date, integer → string)

---

## Identity Transformations

**ETL Job**: `identity-migration-etl-job`

### Entity: identity-people (User Profiles)

**Source**: `User`, `Simpplr__People__c` (Salesforce)

**Target**: `identity_mgmt.users`, `identity_mgmt.people`

**Transformation Logic**:
```typescript
// Extract - Join User and People__c
SELECT
  u.Id as UserId,
  u.Email,
  u.FirstName,
  u.LastName,
  u.IsActive,
  u.ProfileId,
  spc.Id as PeopleId,
  spc.Simpplr__User__c,
  spc.Simpplr__Bio__c,
  spc.Simpplr__Location__c,
  spc.Simpplr__Phone__c,
  spc.Simpplr__Manager__c,       // Lookup to another User
  spc.Simpplr__Department__c,
  spc.Simpplr__Job_Title__c,
  spc.Simpplr__Profile_Image_URL__c,
  spc.Simpplr__Cover_Image_URL__c
FROM User u
INNER JOIN Simpplr__People__c spc ON u.Id = spc.Simpplr__User__c
WHERE u.IsActive = true

// Transform - Create user record
const user = {
  id: generateUUID(),
  external_id: salesforce.UserId,
  email: salesforce.Email,
  first_name: salesforce.FirstName,
  last_name: salesforce.LastName,
  is_active: salesforce.IsActive,
  profile_id: lookupProfileId(salesforce.ProfileId),
  tenant_id: context.tenantId,
  created_at: salesforce.CreatedDate
};

// Transform - Create people record (extended profile)
const people = {
  id: generateUUID(),
  external_id: salesforce.PeopleId,
  user_id: user.id,
  bio: salesforce.Simpplr__Bio__c,
  location: salesforce.Simpplr__Location__c,
  phone: salesforce.Simpplr__Phone__c,
  manager_id: lookupUserId(salesforce.Simpplr__Manager__c),  // Self-referential lookup
  department: salesforce.Simpplr__Department__c,
  job_title: salesforce.Simpplr__Job_Title__c,
  profile_image_url: salesforce.Simpplr__Profile_Image_URL__c,
  cover_image_url: salesforce.Simpplr__Cover_Image_URL__c,
  tenant_id: context.tenantId
};
```

**Complex Lookups**:
- **Manager lookup**: Self-referential join to resolve manager user ID
- **Profile lookup**: Map Salesforce Profile to Zeus profile

**Validation**:
- Email must be valid format
- Active users only

---

### Entity: identity-people-categories (People Categories)

**Source**: `Simpplr__People_Category__c` (Salesforce)

**Target**: `identity_mgmt.people_categories`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Type__c,
  Simpplr__Is_Active__c
FROM Simpplr__People_Category__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  category_type: salesforce.Simpplr__Type__c,
  is_active: salesforce.Simpplr__Is_Active__c,
  tenant_id: context.tenantId
}
```

---

### Entity: identity-segments (Audience Segments)

**Source**: `Simpplr__Audience__c`, `Simpplr__Audience_Member__c` (Salesforce)

**Target**: `identity_mgmt.audiences`, `identity_mgmt.audience_members`

**Transformation Logic**:
```typescript
// Extract Audiences
SELECT
  Id,
  Name,
  Simpplr__Segment__c,          // FK to Segment
  Simpplr__Criteria__c,
  Simpplr__Is_Active__c
FROM Simpplr__Audience__c

// Transform Audience
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  segment_id: lookupSegmentId(salesforce.Simpplr__Segment__c),
  criteria: JSON.parse(salesforce.Simpplr__Criteria__c),
  is_active: salesforce.Simpplr__Is_Active__c,
  tenant_id: context.tenantId
}

// Extract Audience Members
SELECT
  Id,
  Simpplr__Audience__c,         // FK to Audience
  Simpplr__User__c              // FK to User
FROM Simpplr__Audience_Member__c

// Transform Audience Member (junction table)
{
  id: generateUUID(),
  external_id: salesforce.Id,
  audience_id: lookupAudienceId(salesforce.Simpplr__Audience__c),
  user_id: lookupUserId(salesforce.Simpplr__User__c),
  tenant_id: context.tenantId
}
```

**Data Model**: Many-to-many relationship via junction table

---

### Entity: identity-expertise (User Expertise)

**Source**: `Simpplr__People_Expertise__c`, `Simpplr__People_Expertise_Detail__c` (Salesforce)

**Target**: `identity_mgmt.people_expertise`, `identity_mgmt.expertise_endorsements`

**Transformation Logic**:
```typescript
// Extract Expertise
SELECT
  pe.Id,
  pe.Simpplr__People__c,        // FK to People
  pe.Simpplr__Skill_Name__c,
  pe.Simpplr__Proficiency_Level__c
FROM Simpplr__People_Expertise__c pe

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  people_id: lookupPeopleId(salesforce.Simpplr__People__c),
  skill_name: salesforce.Simpplr__Skill_Name__c,
  proficiency_level: salesforce.Simpplr__Proficiency_Level__c,
  tenant_id: context.tenantId
}

// Extract Expertise Details (Endorsements)
SELECT
  ped.Id,
  ped.Simpplr__People_Expertise__c,  // FK to Expertise
  ped.Simpplr__Endorsed_By__c,       // FK to User
  ped.Simpplr__Endorsement_Date__c
FROM Simpplr__People_Expertise_Detail__c ped

// Transform Endorsement
{
  id: generateUUID(),
  external_id: salesforce.Id,
  expertise_id: lookupExpertiseId(salesforce.Simpplr__People_Expertise__c),
  endorsed_by_user_id: lookupUserId(salesforce.Simpplr__Endorsed_By__c),
  endorsement_date: salesforce.Simpplr__Endorsement_Date__c,
  tenant_id: context.tenantId
}
```

---

## Content Transformations

**ETL Job**: `content-migration-etl-job-n`

### Entity: cont-content (Main Content)

**Source**: `Simpplr__Content__c` (Salesforce)

**Target**: `content_mgmt.contents`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Title__c,
  Simpplr__Body__c,              // Rich text HTML
  Simpplr__Content_Type__c,      // blog, event, album
  Simpplr__Site__c,              // FK to Site
  Simpplr__Created_By__c,        // FK to User
  Simpplr__Published_Date__c,
  Simpplr__Is_Published__c,
  Simpplr__View_Count__c,
  Simpplr__Like_Count__c,
  Simpplr__Comment_Count__c,
  Simpplr__Primary_Image_URL__c,
  CreatedDate,
  LastModifiedDate
FROM Simpplr__Content__c
WHERE Simpplr__Is_Deleted__c = false

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  title: salesforce.Simpplr__Title__c,
  body: sanitizeHTML(salesforce.Simpplr__Body__c),  // Clean HTML
  content_type: salesforce.Simpplr__Content_Type__c,
  site_id: lookupSiteId(salesforce.Simpplr__Site__c),
  created_by_user_id: lookupUserId(salesforce.Simpplr__Created_By__c),
  published_date: salesforce.Simpplr__Published_Date__c,
  is_published: salesforce.Simpplr__Is_Published__c,
  view_count: salesforce.Simpplr__View_Count__c || 0,
  like_count: salesforce.Simpplr__Like_Count__c || 0,
  comment_count: salesforce.Simpplr__Comment_Count__c || 0,
  primary_image_url: salesforce.Simpplr__Primary_Image_URL__c,
  tenant_id: context.tenantId,
  created_at: salesforce.CreatedDate,
  updated_at: salesforce.LastModifiedDate
}
```

**Business Rules**:
- HTML sanitization for security
- Default counters to 0 if null
- Content type validation (blog, event, album)

---

### Entity: cont-sites (Intranet Sites)

**Source**: `Simpplr__Site__c` (Salesforce)

**Target**: `content_mgmt.sites`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Title__c,
  Simpplr__Description__c,
  Simpplr__Site_Type__c,
  Simpplr__Is_Active__c,
  Simpplr__Landing_Page__c,
  Simpplr__Logo_URL__c,
  Simpplr__Cover_Image_URL__c,
  Simpplr__Member_Count__c
FROM Simpplr__Site__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  title: salesforce.Simpplr__Title__c,
  description: salesforce.Simpplr__Description__c,
  site_type: salesforce.Simpplr__Site_Type__c,
  is_active: salesforce.Simpplr__Is_Active__c,
  landing_page: salesforce.Simpplr__Landing_Page__c,
  logo_url: salesforce.Simpplr__Logo_URL__c,
  cover_image_url: salesforce.Simpplr__Cover_Image_URL__c,
  member_count: salesforce.Simpplr__Member_Count__c || 0,
  tenant_id: context.tenantId
}
```

---

### Entity: cont-folders (File Folders)

**Source**: `Simpplr__Folder__c` (Salesforce)

**Target**: `content_mgmt.folders`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Parent_Folder__c,    // Self-referential FK
  Simpplr__Site__c,
  Simpplr__Path__c,
  Simpplr__Is_Active__c
FROM Simpplr__Folder__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  parent_folder_id: lookupFolderId(salesforce.Simpplr__Parent_Folder__c),  // Hierarchical
  site_id: lookupSiteId(salesforce.Simpplr__Site__c),
  path: salesforce.Simpplr__Path__c,
  is_active: salesforce.Simpplr__Is_Active__c,
  tenant_id: context.tenantId
}
```

**Complex Pattern**: Hierarchical folder structure with self-referential parent

---

### Entity: cont-files (Files)

**Source**: `Simpplr__File__c`, `ContentDocument`, `ContentVersion` (Salesforce)

**Target**: `content_mgmt.files`

**Transformation Logic**:
```typescript
// Extract - Join Simpplr__File__c with ContentDocument/ContentVersion
SELECT
  sf.Id,
  sf.Name,
  sf.Simpplr__Folder__c,
  sf.Simpplr__Content_Document_Id__c,
  cd.Title,
  cd.FileType,
  cd.FileExtension,
  cv.ContentSize,
  cv.VersionData,              // Binary/URL
  cv.VersionNumber,
  cv.CreatedById
FROM Simpplr__File__c sf
LEFT JOIN ContentDocument cd ON sf.Simpplr__Content_Document_Id__c = cd.Id
LEFT JOIN ContentVersion cv ON cd.LatestPublishedVersionId = cv.Id

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  title: contentDocument.Title,
  file_type: contentDocument.FileType,
  file_extension: contentDocument.FileExtension,
  file_size: contentVersion.ContentSize,
  version_number: contentVersion.VersionNumber,
  folder_id: lookupFolderId(salesforce.Simpplr__Folder__c),
  s3_url: null,  // Will be populated by separate file migration process
  created_by_user_id: lookupUserId(contentVersion.CreatedById),
  tenant_id: context.tenantId
}
```

**File Migration**: Binary data (`VersionData`) migrated separately to S3, then S3 URL stored

---

### Entity: cont-topics (Content Topics)

**Source**: `Simpplr__Topic__c`, `Topic` (Salesforce)

**Target**: `content_mgmt.topics`

**Transformation Logic**:
```typescript
// Extract from both custom and standard Topic objects
SELECT
  st.Id,
  st.Name,
  st.Description
FROM Simpplr__Topic__c st

UNION ALL

SELECT
  t.Id,
  t.Name,
  t.Description
FROM Topic t

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  description: salesforce.Description,
  tenant_id: context.tenantId
}
```

**Data Consolidation**: Merge standard and custom topic objects

---

### Entity: cont-subscriptions (Content Subscriptions)

**Source**: `Simpplr__Subscription__c` (Salesforce)

**Target**: `content_mgmt.subscriptions`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__User__c,
  Simpplr__Entity_Type__c,      // content, site, user
  Simpplr__Entity_Id__c,
  Simpplr__Notification_Frequency__c,
  Simpplr__Is_Active__c
FROM Simpplr__Subscription__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  user_id: lookupUserId(salesforce.Simpplr__User__c),
  entity_type: salesforce.Simpplr__Entity_Type__c,
  entity_id: lookupEntityId(salesforce.Simpplr__Entity_Id__c, salesforce.Simpplr__Entity_Type__c),
  notification_frequency: salesforce.Simpplr__Notification_Frequency__c,
  is_active: salesforce.Simpplr__Is_Active__c,
  tenant_id: context.tenantId
}
```

**Polymorphic Lookup**: `entity_id` can reference different tables based on `entity_type`

---

### Entity: cont-events (Events)

**Source**: `Simpplr__Event__c` (Salesforce)

**Target**: `content_mgmt.events`

**Transformation Logic**:
```typescript
// Extract
SELECT
  e.Id,
  e.Simpplr__Content__c,        // FK to Content
  e.Simpplr__Start_DateTime__c,
  e.Simpplr__End_DateTime__c,
  e.Simpplr__Location__c,
  e.Simpplr__Max_Attendees__c,
  e.Simpplr__Is_Virtual__c,
  e.Simpplr__Meeting_Link__c
FROM Simpplr__Event__c e

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  content_id: lookupContentId(salesforce.Simpplr__Content__c),
  start_datetime: salesforce.Simpplr__Start_DateTime__c,
  end_datetime: salesforce.Simpplr__End_DateTime__c,
  location: salesforce.Simpplr__Location__c,
  max_attendees: salesforce.Simpplr__Max_Attendees__c,
  is_virtual: salesforce.Simpplr__Is_Virtual__c,
  meeting_link: salesforce.Simpplr__Meeting_Link__c,
  tenant_id: context.tenantId
}
```

**Validation**: Start date must be before end date

---

### Entity: cont-likes (Content Likes)

**Source**: `Simpplr__Like__c` (Salesforce)

**Target**: `content_mgmt.likes`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__User__c,
  Simpplr__Entity_Type__c,      // content, feed_item, comment
  Simpplr__Entity_Id__c,
  CreatedDate
FROM Simpplr__Like__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  user_id: lookupUserId(salesforce.Simpplr__User__c),
  entity_type: salesforce.Simpplr__Entity_Type__c,
  entity_id: lookupEntityId(salesforce.Simpplr__Entity_Id__c, salesforce.Simpplr__Entity_Type__c),
  created_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}
```

**Polymorphic Pattern**: Same as subscriptions, entity_id references different tables

---

## Feed Transformations

**ETL Job**: `feed-migration-etl-job-n`

### Entity: feed-feed-posts (Chatter Feed Posts)

**Source**: `Simpplr__Feed_Item__c`, `FeedItem` (Salesforce)

**Target**: `content_mgmt.feed_items`

**Transformation Logic**:
```typescript
// Extract from custom feed items
SELECT
  sfi.Id,
  sfi.Simpplr__Body__c,
  sfi.Simpplr__Created_By__c,
  sfi.Simpplr__Parent_Id__c,    // Site, User, or Content
  sfi.Simpplr__Parent_Type__c,
  sfi.Simpplr__Type__c,
  sfi.Simpplr__Image_URL__c,
  sfi.Simpplr__Link_URL__c,
  sfi.Simpplr__Is_Deleted__c,
  sfi.CreatedDate
FROM Simpplr__Feed_Item__c sfi
WHERE sfi.Simpplr__Is_Deleted__c = false

UNION ALL

// Extract from standard FeedItem
SELECT
  fi.Id,
  fi.Body,
  fi.CreatedById,
  fi.ParentId,
  fi.Type,
  NULL as ImageURL,
  fi.LinkUrl,
  fi.IsDeleted,
  fi.CreatedDate
FROM FeedItem fi
WHERE fi.IsDeleted = false

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  body: sanitizeHTML(salesforce.Body),
  created_by_user_id: lookupUserId(salesforce.CreatedById),
  parent_id: lookupParentId(salesforce.ParentId, salesforce.ParentType),
  parent_type: salesforce.ParentType,
  feed_type: salesforce.Type,
  image_url: salesforce.ImageURL,
  link_url: salesforce.LinkUrl,
  tenant_id: context.tenantId,
  created_at: salesforce.CreatedDate
}
```

**Data Consolidation**: Merge standard FeedItem and custom Simpplr__Feed_Item__c

---

### Entity: feed-comments (Feed Comments)

**Source**: `Simpplr__Feed_Item_Comment__c`, `FeedComment` (Salesforce)

**Target**: `content_mgmt.feed_comments`

**Transformation Logic**:
```typescript
// Extract from custom comments
SELECT
  sfic.Id,
  sfic.Simpplr__Feed_Item__c,
  sfic.Simpplr__Comment_Text__c,
  sfic.Simpplr__Created_By__c,
  sfic.CreatedDate
FROM Simpplr__Feed_Item_Comment__c sfic

UNION ALL

// Extract from standard FeedComment
SELECT
  fc.Id,
  fc.FeedItemId,
  fc.CommentBody,
  fc.CreatedById,
  fc.CreatedDate
FROM FeedComment fc

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  feed_item_id: lookupFeedItemId(salesforce.FeedItemId),
  comment_text: sanitizeHTML(salesforce.CommentText),
  created_by_user_id: lookupUserId(salesforce.CreatedById),
  created_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}
```

---

### Entity: feed-user-followers (User Connections)

**Source**: Derived from `Simpplr__Subscription__c` where `Entity_Type = 'User'`

**Target**: `identity_mgmt.user_followers`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__User__c as FollowerId,
  Simpplr__Entity_Id__c as FollowedUserId,
  CreatedDate
FROM Simpplr__Subscription__c
WHERE Simpplr__Entity_Type__c = 'User'
  AND Simpplr__Is_Active__c = true

// Transform
{
  id: generateUUID(),
  follower_user_id: lookupUserId(salesforce.FollowerId),
  followed_user_id: lookupUserId(salesforce.FollowedUserId),
  followed_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}
```

**Business Logic**: Derived relationship from subscription entity

---

### Entity: qna-question (Q&A Questions)

**Source**: `Simpplr__Question__c` (Salesforce)

**Target**: `content_mgmt.questions`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__Question_Text__c,
  Simpplr__Created_By__c,
  Simpplr__Site__c,
  Simpplr__Is_Answered__c,
  Simpplr__Best_Answer__c,      // FK to Answer
  Simpplr__View_Count__c,
  CreatedDate
FROM Simpplr__Question__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  question_text: salesforce.Simpplr__Question_Text__c,
  created_by_user_id: lookupUserId(salesforce.Simpplr__Created_By__c),
  site_id: lookupSiteId(salesforce.Simpplr__Site__c),
  is_answered: salesforce.Simpplr__Is_Answered__c,
  best_answer_id: null,  // Populated in second pass after answers migrated
  view_count: salesforce.Simpplr__View_Count__c || 0,
  created_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}
```

**Two-Pass Migration**: Best answer FK populated after answers are migrated

---

### Entity: qna-answer (Q&A Answers)

**Source**: `Simpplr__Answer__c` (Salesforce)

**Target**: `content_mgmt.answers`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__Question__c,
  Simpplr__Answer_Text__c,
  Simpplr__Created_By__c,
  Simpplr__Vote_Count__c,
  CreatedDate
FROM Simpplr__Answer__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  question_id: lookupQuestionId(salesforce.Simpplr__Question__c),
  answer_text: sanitizeHTML(salesforce.Simpplr__Answer_Text__c),
  created_by_user_id: lookupUserId(salesforce.Simpplr__Created_By__c),
  vote_count: salesforce.Simpplr__Vote_Count__c || 0,
  created_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}

// Second pass: Update questions with best_answer_id
UPDATE questions
SET best_answer_id = lookupAnswerId(salesforce.Simpplr__Best_Answer__c)
WHERE external_id IN (SELECT Simpplr__Question__c FROM Simpplr__Answer__c)
```

---

### Entity: qna-vote (Q&A Votes)

**Source**: `Simpplr__Vote__c` (Salesforce)

**Target**: `content_mgmt.votes`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__User__c,
  Simpplr__Answer__c,
  Simpplr__Vote_Type__c,        // upvote, downvote
  CreatedDate
FROM Simpplr__Vote__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  user_id: lookupUserId(salesforce.Simpplr__User__c),
  answer_id: lookupAnswerId(salesforce.Simpplr__Answer__c),
  vote_type: salesforce.Simpplr__Vote_Type__c,
  created_at: salesforce.CreatedDate,
  tenant_id: context.tenantId
}
```

---

## Native Video Transformations

**ETL Job**: `native-video-migration-etl-job`

### Entity: nv-category (Video Categories)

**Source**: `Simpplr__Category__c` (Salesforce)

**Target**: `content_mgmt.video_categories`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Name,
  Simpplr__Description__c,
  Simpplr__Kaltura_Category_Id__c,
  Simpplr__Parent_Category__c,  // Hierarchical
  Simpplr__Is_Active__c
FROM Simpplr__Category__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  description: salesforce.Simpplr__Description__c,
  kaltura_category_id: salesforce.Simpplr__Kaltura_Category_Id__c,
  parent_category_id: lookupCategoryId(salesforce.Simpplr__Parent_Category__c),
  is_active: salesforce.Simpplr__Is_Active__c,
  tenant_id: context.tenantId
}
```

---

### Entity: nv-video-info (Video Metadata)

**Source**: `Simpplr__Video_Info__c` (Salesforce)

**Target**: `content_mgmt.videos`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__Title__c,
  Simpplr__Description__c,
  Simpplr__Kaltura_Entry_Id__c,
  Simpplr__Duration__c,
  Simpplr__Thumbnail_URL__c,
  Simpplr__Video_URL__c,
  Simpplr__Created_By__c,
  Simpplr__View_Count__c,
  CreatedDate
FROM Simpplr__Video_Info__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  title: salesforce.Simpplr__Title__c,
  description: salesforce.Simpplr__Description__c,
  kaltura_entry_id: salesforce.Simpplr__Kaltura_Entry_Id__c,
  duration_seconds: salesforce.Simpplr__Duration__c,
  thumbnail_url: salesforce.Simpplr__Thumbnail_URL__c,
  video_url: salesforce.Simpplr__Video_URL__c,
  created_by_user_id: lookupUserId(salesforce.Simpplr__Created_By__c),
  view_count: salesforce.Simpplr__View_Count__c || 0,
  tenant_id: context.tenantId,
  created_at: salesforce.CreatedDate
}
```

---

### Entity: nv-permission-group (Video Permissions)

**Source**: `Simpplr__Permission_Group__c`, `Simpplr__Permission_Group_Member__c` (Salesforce)

**Target**: `content_mgmt.video_permission_groups`, `content_mgmt.video_permission_members`

**Transformation Logic**:
```typescript
// Extract Permission Groups
SELECT
  Id,
  Name,
  Simpplr__Description__c,
  Simpplr__Group_Type__c
FROM Simpplr__Permission_Group__c

// Transform Group
{
  id: generateUUID(),
  external_id: salesforce.Id,
  name: salesforce.Name,
  description: salesforce.Simpplr__Description__c,
  group_type: salesforce.Simpplr__Group_Type__c,
  tenant_id: context.tenantId
}

// Extract Group Members
SELECT
  Id,
  Simpplr__Permission_Group__c,
  Simpplr__User__c
FROM Simpplr__Permission_Group_Member__c

// Transform Member
{
  id: generateUUID(),
  external_id: salesforce.Id,
  permission_group_id: lookupPermissionGroupId(salesforce.Simpplr__Permission_Group__c),
  user_id: lookupUserId(salesforce.Simpplr__User__c),
  tenant_id: context.tenantId
}
```

---

### Entity: nv-category-entry (Kaltura Category Mappings)

**Source**: `Simpplr__Category_Entry__c` (Salesforce)

**Target**: `content_mgmt.video_category_mappings`

**Transformation Logic**:
```typescript
// Extract
SELECT
  Id,
  Simpplr__Category__c,
  Simpplr__Video_Info__c,
  Simpplr__Kaltura_Entry_Id__c,
  Simpplr__Kaltura_Category_Id__c
FROM Simpplr__Category_Entry__c

// Transform
{
  id: generateUUID(),
  external_id: salesforce.Id,
  category_id: lookupCategoryId(salesforce.Simpplr__Category__c),
  video_id: lookupVideoId(salesforce.Simpplr__Video_Info__c),
  kaltura_entry_id: salesforce.Simpplr__Kaltura_Entry_Id__c,
  kaltura_category_id: salesforce.Simpplr__Kaltura_Category_Id__c,
  tenant_id: context.tenantId
}
```

---

## Common Transformation Patterns

### 1. ID Mapping Pattern

All transformations follow this pattern:

```typescript
// Salesforce ID → Zeus UUID mapping
{
  id: generateUUID(),           // New internal ID
  external_id: salesforce.Id,   // Original Salesforce ID
  // ... other fields
}

// Lookup function for FK resolution
function lookupUserId(salesforceUserId: string): string {
  const mapping = getMappingFromCache('User', salesforceUserId);
  if (!mapping) {
    throw new Error(`User mapping not found: ${salesforceUserId}`);
  }
  return mapping.zeusId;
}
```

**Implementation**: Maintain in-memory cache of Salesforce ID → Zeus UUID mappings

---

### 2. Multi-Tenant Isolation

Every record includes `tenant_id`:

```typescript
{
  // ... fields
  tenant_id: context.tenantId  // Extracted from ORG_ID environment variable
}
```

---

### 3. Soft Delete Filtering

```typescript
WHERE Simpplr__Is_Deleted__c = false
AND IsDeleted = false
```

Always filter soft-deleted records at extract time.

---

### 4. JSON Field Parsing

```typescript
// Source: Simpplr__Settings__c (JSON string)
settings: JSON.parse(salesforce.Simpplr__Settings__c || '{}')

// Validation
try {
  const settings = JSON.parse(salesforce.Simpplr__Settings__c);
} catch (e) {
  logger.error(`Invalid JSON in settings: ${salesforce.Id}`);
  settings = {};
}
```

---

### 5. HTML Sanitization

```typescript
function sanitizeHTML(html: string): string {
  // Strip dangerous tags: <script>, <iframe>, <object>
  // Allow safe tags: <p>, <b>, <i>, <a>, <ul>, <ol>, <li>
  return sanitizer.sanitize(html);
}
```

---

### 6. Polymorphic Relationships

```typescript
// entity_type + entity_id pattern
function lookupEntityId(salesforceId: string, entityType: string): string {
  switch(entityType) {
    case 'content':
      return lookupContentId(salesforceId);
    case 'site':
      return lookupSiteId(salesforceId);
    case 'user':
      return lookupUserId(salesforceId);
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}
```

---

### 7. Two-Pass Migration (Circular Dependencies)

```typescript
// Pass 1: Create records without circular FK
INSERT INTO questions (id, external_id, question_text, best_answer_id)
VALUES (uuid, salesforce.Id, salesforce.Text, NULL);

// Pass 2: Update circular FK after all dependent records exist
UPDATE questions
SET best_answer_id = lookupAnswerId(salesforce.Simpplr__Best_Answer__c)
WHERE best_answer_id IS NULL;
```

---

### 8. Aggregation & Counters

```typescript
// Denormalized counters
{
  view_count: salesforce.Simpplr__View_Count__c || 0,
  like_count: salesforce.Simpplr__Like_Count__c || 0,
  comment_count: salesforce.Simpplr__Comment_Count__c || 0
}

// Alternative: Calculate from child tables
SELECT content_id, COUNT(*) as like_count
FROM likes
WHERE entity_type = 'content'
GROUP BY content_id
```

---

### 9. Hierarchical Data (Self-Referential FK)

```typescript
// Manager → User, Parent Folder → Folder
{
  id: generateUUID(),
  external_id: salesforce.Id,
  parent_id: lookupSameTableId(salesforce.Parent__c),  // May be null for root
  // ... other fields
}

// Process in topological order (parents before children)
const sortedRecords = topologicalSort(records, 'Parent__c');
```

---

### 10. Data Type Conversions

```typescript
// Salesforce types → PostgreSQL types
{
  created_at: new Date(salesforce.CreatedDate),        // String → Timestamp
  is_active: salesforce.Is_Active__c === 'true',       // String → Boolean
  view_count: parseInt(salesforce.View_Count__c, 10),  // String → Integer
  settings: JSON.parse(salesforce.Settings__c)         // String → JSONB
}
```

---

## Migration Implementation Notes for AWS Glue

### Glue Job Structure

Each Glue job should:

1. **Extract**: Read JSON from S3 (AppFlow output)
2. **Load Mapping Cache**: Query Zeus DB for existing ID mappings
3. **Transform**: Apply transformations using PySpark
4. **Validate**: Check data quality
5. **Load**: UPSERT to Zeus DB
6. **Update EMS**: Mark entity as completed in DynamoDB

### Glue Job Template

```python
import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
import boto3
import json

args = getResolvedOptions(sys.argv, [
    'JOB_NAME',
    'ENTITY_NAME',
    'ZEUS_DB_SECRET_ARN',
    'RAW_DATA_BUCKET',
    'PROCESSED_DATA_BUCKET'
])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# 1. Extract from S3
s3_path = f"s3://{args['RAW_DATA_BUCKET']}/salesforce/{args['ENTITY_NAME']}/"
df = spark.read.json(s3_path)

# 2. Load ID mappings from Zeus DB
db_creds = get_secret(args['ZEUS_DB_SECRET_ARN'])
mapping_df = spark.read.jdbc(
    url=db_creds['url'],
    table='id_mappings',
    properties=db_creds
)

# 3. Transform
transformed_df = df.join(mapping_df, df.Id == mapping_df.external_id, 'left') \
    .select(
        udf_generate_uuid().alias('id'),
        col('Id').alias('external_id'),
        # ... field mappings
    )

# 4. Validate
validated_df = transformed_df.filter(col('email').rlike(r'^[\w\.-]+@[\w\.-]+\.\w+$'))

# 5. Load to Zeus DB
validated_df.write.jdbc(
    url=db_creds['url'],
    table=args['TARGET_TABLE'],
    mode='append',
    properties=db_creds
)

# 6. Update EMS
update_ems(args['ENTITY_NAME'], 'completed')

job.commit()
```

---

## Next Steps

1. **Create Glue Job Scripts**: Implement PySpark scripts for each entity in `src-backend/glue-jobs/`
2. **Build ID Mapping Service**: Create DynamoDB table or RDS table for ID mappings
3. **Implement UDFs**: Create Spark UDFs for common transformations (sanitizeHTML, generateUUID, etc.)
4. **Test Data Quality**: Add Great Expectations or AWS Deequ for data validation
5. **Optimize Performance**: Partition S3 data, tune Spark configs, cache lookups

---

## Appendix: Entity Dependencies

Migration order based on foreign key dependencies:

```
Rank 200:
  - User (no dependencies)
  - Profile (no dependencies)
  - People_Category (no dependencies)

Rank 300:
  - Segment (depends on: User for created_by)

Rank 400:
  - Audience (depends on: Segment)
  - Audience_Member (depends on: Audience, User)

Rank 500:
  - People (depends on: User, User for manager)

Rank 600:
  - App_Config, App_Default, Help_And_Feedback
  - People_Expertise (depends on: People)
  - LMA Feature Flags

Rank 700:
  - People_Expertise_Detail (depends on: People_Expertise, User for endorser)

... (continues through all ranks)
```

This dependency graph must be respected when scheduling Glue jobs via Step Functions.
