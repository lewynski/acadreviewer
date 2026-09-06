/** Builds the file, hands it to the browser, and reports on the button. */
  async function keep(button, note) {
    if (!paper) return;
    var was = button.textContent;
    button.disabled = true;
    button.textContent = 'Building the file...';
    try {
      var file = await AR.exporter.save(paper);
      button.textContent = 'Saved';
      if (note) note.textContent = file.name + ', ' + sizeText(file.size) + ', opens with no internet.';
      setTimeout(function () {
        button.textContent = was;
        button.disabled = false;
      }, 2400);
    } catch (err) {
      button.textContent = was;
      button.disabled = false;
      var errMsg = err && err.message ? err.message : 'The file could not be built.';
      
      // If there is a note element, show it there. Otherwise, force an alert so it doesn't fail silently.
      if (note) {
        note.textContent = errMsg;
      } else {
        alert("Export failed: " + errMsg);
        console.error("PDF Export Error Details:", err);
      }
    }
  }
