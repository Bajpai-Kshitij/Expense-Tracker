package com.bajpai.expense.tracker;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(
    name = "ExpenseNative",
    permissions = {
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.READ_SMS }
        )
    }
)
public class ExpenseNativePlugin extends Plugin {

    private boolean isValidFilename(String name) {
        if (name == null || name.trim().isEmpty()) {
            return false;
        }
        return !name.contains("/") && !name.contains("\\") && !name.contains("..");
    }

    private Uri findChildUri(Uri treeUri, String filename) {
        ContentResolver resolver = getContext().getContentResolver();
        String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocId);
        String[] projection = new String[]{
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };

        try (Cursor cursor = resolver.query(childrenUri, projection, null, null, null)) {
            if (cursor != null) {
                int idIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                while (cursor.moveToNext()) {
                    String name = cursor.getString(nameIdx);
                    if (filename.equals(name)) {
                        String docId = cursor.getString(idIdx);
                        return DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String getDocDisplayName(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        Uri docUri = uri;
        if (DocumentsContract.isTreeUri(uri)) {
            docUri = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
        }
        try (Cursor cursor = resolver.query(docUri, new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                if (idx >= 0) {
                    return cursor.getString(idx);
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickFolderCallback");
    }

    @ActivityCallback
    private void pickFolderCallback(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("User cancelled folder picker", "CANCELLED");
            return;
        }

        Uri treeUri = result.getData().getData();
        try {
            final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);

            String name = getDocDisplayName(treeUri);
            if (name == null || name.isEmpty()) {
                name = treeUri.getLastPathSegment();
            }

            JSObject ret = new JSObject();
            ret.put("uri", treeUri.toString());
            ret.put("name", name != null ? name : "ExpenseSync");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to persist folder permission: " + e.getMessage(), "PERMISSION_ERROR", e);
        }
    }

    @PluginMethod
    public void checkFolder(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing folder uri", "BAD_ARGS");
            return;
        }

        getBridge().execute(() -> {
            try {
                Uri treeUri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                boolean hasRead = false;
                boolean hasWrite = false;

                for (UriPermission perm : resolver.getPersistedUriPermissions()) {
                    if (perm.getUri().equals(treeUri)) {
                        hasRead = perm.isReadPermission();
                        hasWrite = perm.isWritePermission();
                        break;
                    }
                }

                boolean accessible = false;
                if (hasRead) {
                    String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                    Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
                    try (Cursor c = resolver.query(docUri, new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
                        accessible = (c != null && c.moveToFirst());
                    } catch (Exception ignored) {
                        accessible = false;
                    }
                }

                JSObject ret = new JSObject();
                ret.put("ok", accessible && hasRead && hasWrite);
                ret.put("canRead", hasRead);
                ret.put("canWrite", hasWrite);
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("canRead", false);
                ret.put("canWrite", false);
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing folder uri", "BAD_ARGS");
            return;
        }
        String prefix = call.getString("prefix");

        getBridge().execute(() -> {
            try {
                Uri treeUri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocId);

                String[] projection = new String[]{
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                };

                JSArray files = new JSArray();
                try (Cursor cursor = resolver.query(childrenUri, projection, null, null, null)) {
                    if (cursor != null) {
                        int nameIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                        int sizeIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                        int modIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                        int mimeIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);

                        while (cursor.moveToNext()) {
                            String mime = cursor.getString(mimeIdx);
                            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                                continue;
                            }
                            String name = cursor.getString(nameIdx);
                            if (prefix != null && !prefix.isEmpty() && !name.startsWith(prefix)) {
                                continue;
                            }
                            long size = cursor.isNull(sizeIdx) ? 0L : cursor.getLong(sizeIdx);
                            long lastModified = cursor.isNull(modIdx) ? 0L : cursor.getLong(modIdx);

                            JSObject fileObj = new JSObject();
                            fileObj.put("name", name);
                            fileObj.put("size", size);
                            fileObj.put("lastModified", lastModified);
                            files.put(fileObj);
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("files", files);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to list files: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String name = call.getString("name");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing folder uri", "BAD_ARGS");
            return;
        }
        if (!isValidFilename(name)) {
            call.reject("Invalid file name: " + name, "BAD_NAME");
            return;
        }

        getBridge().execute(() -> {
            try {
                Uri treeUri = Uri.parse(uriStr);
                Uri fileUri = findChildUri(treeUri, name);
                if (fileUri == null) {
                    call.reject("File not found: " + name, "NOT_FOUND");
                    return;
                }

                ContentResolver resolver = getContext().getContentResolver();
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                try (InputStream is = resolver.openInputStream(fileUri)) {
                    if (is == null) {
                        call.reject("Failed to open input stream for: " + name, "NOT_FOUND");
                        return;
                    }
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = is.read(buffer)) != -1) {
                        baos.write(buffer, 0, read);
                    }
                }

                String text = baos.toString("UTF-8");
                JSObject ret = new JSObject();
                ret.put("text", text);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to read file: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    @PluginMethod
    public void appendLine(PluginCall call) {
        String uriStr = call.getString("uri");
        String name = call.getString("name");
        String line = call.getString("line");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing folder uri", "BAD_ARGS");
            return;
        }
        if (!isValidFilename(name)) {
            call.reject("Invalid file name: " + name, "BAD_NAME");
            return;
        }
        if (line == null) {
            call.reject("Missing line parameter", "BAD_ARGS");
            return;
        }

        getBridge().execute(() -> {
            try {
                Uri treeUri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                Uri fileUri = findChildUri(treeUri, name);

                if (fileUri == null) {
                    String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                    Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
                    fileUri = DocumentsContract.createDocument(resolver, parentDocUri, "application/octet-stream", name);
                    if (fileUri == null) {
                        call.reject("Failed to create file: " + name, "IO_ERROR");
                        return;
                    }
                }

                byte[] lineBytes = line.getBytes(StandardCharsets.UTF_8);
                boolean appendSucceeded = false;
                String modeUsed = "append";

                // Try native append first ("wa")
                try {
                    OutputStream os = resolver.openOutputStream(fileUri, "wa");
                    if (os != null) {
                        try {
                            os.write(lineBytes);
                            os.flush();
                            appendSucceeded = true;
                        } finally {
                            os.close();
                        }
                    }
                } catch (Throwable ignored) {
                    appendSucceeded = false;
                }

                // Fall back to reading existing content and rewriting ("wt")
                if (!appendSucceeded) {
                    modeUsed = "rewrite";
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    try (InputStream is = resolver.openInputStream(fileUri)) {
                        if (is != null) {
                            byte[] buffer = new byte[8192];
                            int read;
                            while ((read = is.read(buffer)) != -1) {
                                baos.write(buffer, 0, read);
                            }
                        }
                    } catch (Exception ignored) {}
                    baos.write(lineBytes);
                    byte[] fullContent = baos.toByteArray();

                    try (OutputStream os = resolver.openOutputStream(fileUri, "wt")) {
                        if (os == null) {
                            call.reject("Failed to open file for rewriting", "IO_ERROR");
                            return;
                        }
                        os.write(fullContent);
                        os.flush();
                    }
                }

                JSObject ret = new JSObject();
                ret.put("mode", modeUsed);
                ret.put("bytes", lineBytes.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to append line: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String name = call.getString("name");
        String text = call.getString("text");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing folder uri", "BAD_ARGS");
            return;
        }
        if (!isValidFilename(name)) {
            call.reject("Invalid file name: " + name, "BAD_NAME");
            return;
        }
        final String finalText = (text != null) ? text : "";

        getBridge().execute(() -> {
            try {
                Uri treeUri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                Uri fileUri = findChildUri(treeUri, name);

                if (fileUri == null) {
                    String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                    Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
                    fileUri = DocumentsContract.createDocument(resolver, parentDocUri, "application/octet-stream", name);
                    if (fileUri == null) {
                        call.reject("Failed to create file: " + name, "IO_ERROR");
                        return;
                    }
                }

                byte[] bytes = finalText.getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = resolver.openOutputStream(fileUri, "wt")) {
                    if (os == null) {
                        call.reject("Failed to open output stream for: " + name, "IO_ERROR");
                        return;
                    }
                    os.write(bytes);
                    os.flush();
                }

                JSObject ret = new JSObject();
                ret.put("bytes", bytes.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to write file: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    @PluginMethod
    public void readSms(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
        } else {
            readSmsInternal(call);
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            readSmsInternal(call);
        } else {
            call.reject("SMS permission was denied", "PERMISSION_DENIED");
        }
    }

    private void readSmsInternal(PluginCall call) {
        getBridge().execute(() -> {
            Cursor cursor = null;
            try {
                Long sinceEpochMs = call.getLong("sinceEpochMs");
                long since = (sinceEpochMs != null) ? sinceEpochMs : 0L;

                Integer limitParam = call.getInt("limit");
                int limit = (limitParam != null) ? limitParam : 500;
                if (limit <= 0) limit = 500;
                if (limit > 2000) limit = 2000;

                ContentResolver resolver = getContext().getContentResolver();
                Uri inboxUri = Uri.parse("content://sms/inbox");
                String[] projection = new String[]{ "_id", "address", "body", "date" };
                String selection = "date > ?";
                String[] selectionArgs = new String[]{ String.valueOf(since) };
                String sortOrder = "date ASC";

                cursor = resolver.query(inboxUri, projection, selection, selectionArgs, sortOrder);
                JSArray smsList = new JSArray();

                if (cursor != null) {
                    int idIdx = cursor.getColumnIndex("_id");
                    int addrIdx = cursor.getColumnIndex("address");
                    int bodyIdx = cursor.getColumnIndex("body");
                    int dateIdx = cursor.getColumnIndex("date");

                    int count = 0;
                    while (cursor.moveToNext() && count < limit) {
                        JSObject item = new JSObject();
                        item.put("id", cursor.getString(idIdx));
                        item.put("address", cursor.getString(addrIdx));
                        item.put("body", cursor.getString(bodyIdx));
                        item.put("date", cursor.getLong(dateIdx));
                        smsList.put(item);
                        count++;
                    }
                }

                JSObject ret = new JSObject();
                ret.put("sms", smsList);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to read SMS: " + e.getMessage(), "SMS_ERROR", e);
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        });
    }
}

