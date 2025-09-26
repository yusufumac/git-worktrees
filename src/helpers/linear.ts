import { getPreferences } from "../helpers/raycast";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: {
    name: string;
  };
  assignee?: {
    name: string;
  };
  team: {
    name: string;
  };
  branchName: string;
}

interface LinearGraphQLResponse {
  data?: {
    issues?: {
      nodes: LinearIssue[];
    };
    searchIssues?: {
      nodes: LinearIssue[];
    };
  };
  errors?: Array<{ message: string }>;
}

export async function fetchLinearIssues(searchQuery = "", limit = 10): Promise<LinearIssue[]> {
  const preferences = getPreferences();
  const apiKey = preferences.linearApiKey;

  if (!apiKey) {
    throw new Error("Linear API key is not configured. Please set it in the extension preferences.");
  }

  // Use searchIssues with 'term' parameter for text search
  const query = searchQuery
    ? `
      query SearchIssues($searchQuery: String!, $limit: Int!) {
        searchIssues(
          term: $searchQuery,
          first: $limit
        ) {
          nodes {
            id
            identifier
            title
            description
            state {
              name
            }
            assignee {
              name
            }
            team {
              name
            }
            branchName
          }
        }
      }
    `
    : `
      query Issues($limit: Int!) {
        issues(
          first: $limit,
          filter: {
            state: { type: { in: ["unstarted", "started", "backlog"] } }
          }
          orderBy: updatedAt
        ) {
          nodes {
            id
            identifier
            title
            description
            state {
              name
            }
            assignee {
              name
            }
            team {
              name
            }
            branchName
          }
        }
      }
    `;

  const variables: Record<string, any> = { limit };
  if (searchQuery) {
    variables.searchQuery = searchQuery;
  }

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`Linear API request failed: ${response.statusText}`);
  }

  const result = (await response.json()) as LinearGraphQLResponse;

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Linear API error: ${result.errors[0].message}`);
  }

  // Handle both searchIssues and issues response
  const issues = searchQuery ? result.data?.searchIssues?.nodes : result.data?.issues?.nodes;

  if (!issues) {
    return [];
  }

  return issues;
}

export async function fetchLinearIssueBranchName(issueId: string): Promise<string> {
  const preferences = getPreferences();
  const apiKey = preferences.linearApiKey;

  if (!apiKey) {
    throw new Error("Linear API key is not configured. Please set it in the extension preferences.");
  }

  const query = `
    query Issue($id: String!) {
      issue(id: $id) {
        branchName
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query,
      variables: { id: issueId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Linear API request failed: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Linear API error: ${result.errors[0].message}`);
  }

  return result.data?.issue?.branchName || "";
}
