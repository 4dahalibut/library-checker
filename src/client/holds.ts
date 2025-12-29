interface Hold {
  holdId: string;
  bibId: string;
  title: string;
  author: string;
  format: string;
  year: string;
  status: string;
  statusText: string;
}

async function loadHolds() {
  try {
    const res = await fetch("/api/holds");
    const data = await res.json();

    if (data.error) {
      document.getElementById("app")!.innerHTML = '<center><font color="red">Failed to load holds</font></center>';
      return;
    }

    const holds: Hold[] = data.holds || [];
    if (holds.length === 0) {
      document.getElementById("app")!.innerHTML = '<center><font face="Times New Roman, serif"><i>No holds found.</i></font></center>';
      return;
    }

    document.getElementById("app")!.innerHTML = `
      <div class="table-scroll">
      <table class="data-table">
        <tr bgcolor="#cccccc">
          <th align="left">Title</th>
          <th align="left">Author</th>
          <th align="center">Format</th>
          <th align="center">Status</th>
          <th align="center">Action</th>
        </tr>
        ${holds
          .map(
            (h) => `
          <tr id="hold-${h.holdId}">
            <td>${escapeHtml(h.title)}</td>
            <td><font size="2">${escapeHtml(h.author)}</font></td>
            <td align="center"><font size="2">${h.format} ${h.year}</font></td>
            <td align="center">
              <font color="${h.status === "ready" ? "green" : h.status === "in_transit" ? "#cc9900" : "gray"}">
                <b>${escapeHtml(h.statusText)}</b>
              </font>
            </td>
            <td align="center">
              <input type="button" class="action-btn" value="Cancel" onclick="cancelHold('${h.holdId}', '${h.bibId}')">
            </td>
          </tr>
        `
          )
          .join("")}
      </table>
      </div>
    `;
  } catch {
    document.getElementById("app")!.innerHTML = '<center><font color="red">Error loading holds</font></center>';
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function cancelHold(holdId: string, metadataId: string) {
  if (!confirm("Cancel this hold?")) return;
  const btn = (event as Event).target as HTMLInputElement;
  btn.disabled = true;
  btn.value = "...";
  try {
    const res = await fetch("/api/hold/" + holdId, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadataId }),
    });
    const result = await res.json();
    if (result.success) {
      document.getElementById("hold-" + holdId)?.remove();
    } else {
      alert(result.message);
      btn.value = "Cancel";
      btn.disabled = false;
    }
  } catch {
    alert("Error cancelling hold");
    btn.value = "Cancel";
    btn.disabled = false;
  }
}

// Expose to global scope for onclick handlers
declare global {
  interface Window {
    cancelHold: typeof cancelHold;
  }
}

window.cancelHold = cancelHold;

// Set last updated
const lastUpdatedEl = document.getElementById("last-updated");
if (lastUpdatedEl) {
  lastUpdatedEl.textContent = `Last updated: ${new Date().toLocaleDateString()}`;
}

loadHolds();
