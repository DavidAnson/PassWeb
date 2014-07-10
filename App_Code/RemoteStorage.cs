// Restore to allow callers to list files (not required for PassWeb)
//#define ALLOW_LIST

// Remove to prevent the creation of backup files for each change
#define BACKUP_FILE

// Remove to allow the creation of new files
#define BLOCK_NEW

// Restore to enable simple support for Cross-Origin Resource Sharing
//#define SIMPLE_CORS

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;

/// <summary>
/// HTTP Handler that provides a simple REST API for PassWeb to create/read/update/delete data files on the server.
/// </summary>
public class RemoteStorage : IHttpHandler
{
#if SIMPLE_CORS
    // CORS header names
    private const string OriginHeaderName = "Origin";
    private const string AccessControlAllowOriginHeaderName = "Access-Control-Allow-Origin";
#endif

    /// <summary>
    /// Enables processing of HTTP Web requests by a custom HttpHandler that implements the System.Web.IHttpHandler interface.
    /// </summary>
    /// <param name="context">An System.Web.HttpContext object that provides references to the intrinsic server objects (for example, Request, Response, Session, and Server) used to service HTTP requests.</param>
    public void ProcessRequest(HttpContext context)
    {
        // Setup
        var request = context.Request;
        var response = context.Response;
        response.ContentType = MediaTypeNames.Text.Plain;
        var requestInputStream = request.InputStream;
        var responseOutputStream = response.OutputStream;

        // Validate request path
        if (!request.Path.EndsWith("/RemoteStorage", StringComparison.OrdinalIgnoreCase) &&
            !request.Path.EndsWith("/RemoteStorage/", StringComparison.OrdinalIgnoreCase))
        {
            throw new NotSupportedException("Unsupported request path.");
        }

#if SIMPLE_CORS
        // Handle cross-origin resource sharing (CORS)
        var originHeader = request.Headers[OriginHeaderName];
        if (null != originHeader)
        {
            var requestHost = request.Url.Host;
            var originUri = new Uri(originHeader);
            if (originUri.Host.Equals(requestHost, StringComparison.OrdinalIgnoreCase) &&
                ("/" == originUri.PathAndQuery))
            {
                // Valid request; add response header
                response.AppendHeader(AccessControlAllowOriginHeaderName, originUri.Scheme + "://" + requestHost);
            }
            else
            {
                throw new NotSupportedException("Unsupported value for Origin request header.");
            }
        }
#endif

        // Setup to handle storage request
        var method = request.HttpMethod.ToLowerInvariant();
        var nameParameter = request.Params["name"];
#if BLOCK_NEW
        var previousNameParameter = request.Params["previousName"];
#endif

        if ("post" == method)
        {
            // Map POST/method=ABC to more conventional REST-style request to allow callers to use POST (i.e., without customizing IIS's default HTTP method support)
            method = request.Params["method"];
            if (null == method)
            {
                throw new NotSupportedException("Missing method parameter for POST request.");
            }
            method = method.ToLowerInvariant();
            var contentParameter = request.Params["content"];
            if (null != contentParameter)
            {
                requestInputStream = new MemoryStream(Encoding.UTF8.GetBytes(contentParameter));
            }
        }
        var mappedFileName = (null != nameParameter) ? MapFileName(context.Server, nameParameter) : null;
#if BLOCK_NEW
        var mappedPreviousFileName = (null != previousNameParameter) ? MapFileName(context.Server, previousNameParameter) : null;
#endif

        // Handle supported methods
        if ("put" == method)
        {
            if (null == mappedFileName)
            {
                throw new NotSupportedException("Missing name parameter for PUT method.");
            }
            WriteFile(
                mappedFileName,
#if BLOCK_NEW
                mappedPreviousFileName,
#endif
                requestInputStream);
        }
        else if ("get" == method)
        {
            if (null == mappedFileName)
            {
#if ALLOW_LIST
                ListFiles(context.Server, responseOutputStream);
#else
                throw new NotSupportedException("Missing name parameter for GET method.");
#endif
            }
            else
            {
                ReadFile(mappedFileName, response);
            }
        }
        else if ("delete" == method)
        {
            if (null == mappedFileName)
            {
                throw new NotSupportedException("Missing name parameter for DELETE method.");
            }
            DeleteFile(mappedFileName);
        }
        else
        {
            throw new NotSupportedException("Unsupported HTTP method: " + method + ".");
        }
    }

#if ALLOW_LIST
    /// <summary>
    /// Writes a list of (non-hidden backup) files to the response.
    /// </summary>
    /// <param name="serverUtility">HttpServerUtility instance.</param>
    /// <param name="responseOutputStream">Response stream.</param>
    private void ListFiles(HttpServerUtility serverUtility, Stream responseOutputStream)
    {
        using (var writer = new StreamWriter(responseOutputStream))
        {
            var directory = Path.GetDirectoryName(MapFileName(serverUtility, "placeholder"));
            var hiddenFiles = new Regex(@"\.\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d$");
            foreach (var file in Directory.EnumerateFiles(directory).Where(f => !hiddenFiles.IsMatch(f)))
            {
                writer.WriteLine(Path.GetFileName(file));
            }
        }
    }
#endif

    /// <summary>
    /// Reads a file from storage and writes it to the response.
    /// </summary>
    /// <param name="mappedFileName">Mapped file name.</param>
    /// <param name="response">HttpResponse instance.</param>
    private void ReadFile(string mappedFileName, HttpResponse response)
    {
        response.WriteFile(mappedFileName);
    }

    /// <summary>
    /// Writes a file to storage.
    /// </summary>
    /// <param name="mappedFileName">Mapped file name.</param>
    /// <param name="mappedPreviousFileName">Mapped previous file name.</param>
    /// <param name="requestInputStream">Input stream.</param>
    private void WriteFile(
        string mappedFileName,
#if BLOCK_NEW
        string mappedPreviousFileName,
#endif
        Stream requestInputStream)
    {
#if BLOCK_NEW
        // Only write a file if it already exists OR the caller identifies a different file that exists (i.e., rename)
        if (!File.Exists(mappedFileName) &&
            ((null == mappedPreviousFileName) || !File.Exists(mappedPreviousFileName)))
        {
            throw new NotSupportedException("Creation of new files is not allowed.");
        }

        // Backup/delete previous file if present
        if (null != mappedPreviousFileName)
        {
            BackupFile(mappedPreviousFileName);
            File.Delete(mappedPreviousFileName);
        }
#endif

        // Backup/delete existing file if present
        BackupFile(mappedFileName);
        File.Delete(mappedFileName);

        // Write new content
        using (var stream = new FileStream(mappedFileName, FileMode.CreateNew))
        {
            requestInputStream.CopyTo(stream);
        }
    }

    /// <summary>
    /// Deletes a file from storage.
    /// </summary>
    /// <param name="mappedFileName">Mapped file name.</param>
    private void DeleteFile(string mappedFileName)
    {
        // Fail if no existing file
        if (!File.Exists(mappedFileName))
        {
            throw new NotSupportedException("Can not delete a file that does not exist.");
        }

        // Backup existing file
        BackupFile(mappedFileName);

        // Delete existing file
        File.Delete(mappedFileName);
    }

    /// <summary>
    /// Backs up an existing file and renames it to hide it from view.
    /// </summary>
    /// <param name="mappedFileName">Mapped file name.</param>
    [Conditional("BACKUP_FILE")]
    private static void BackupFile(string mappedFileName)
    {
        if (File.Exists(mappedFileName))
        {
            // Setup
            var writeTime = File.GetLastWriteTime(mappedFileName);
            var backupFileName = mappedFileName + "." + writeTime.ToString("yyyyMMddHHmmssfffffff");

            // Delete existing backup file if present
            File.Delete(backupFileName);

            // Rename file to backup
            File.Move(mappedFileName, backupFileName);
        }
    }

    /// <summary>
    /// Maps a bare file name to a fully-qualified local path.
    /// </summary>
    /// <param name="serverUtility">HttpServerUtility instance.</param>
    /// <param name="fileName">File name.</param>
    /// <returns>Mapped file name.</returns>
    private static string MapFileName(HttpServerUtility serverUtility, string fileName)
    {
        // Create App_Data directory (if necessary)
        var appDataDirectory = serverUtility.MapPath("~/App_Data/PassWeb");
        if (!Directory.Exists(appDataDirectory))
        {
            Directory.CreateDirectory(appDataDirectory);
        }

        // Combine file name with App_Data directory
        var mappedFileName = Path.Combine(appDataDirectory, fileName);
        var fileInfo = new FileInfo(mappedFileName);

        // Make sure the resulting path points where it is supposed to
        if (!string.Equals(appDataDirectory, fileInfo.DirectoryName, StringComparison.OrdinalIgnoreCase))
        {
            throw new NotSupportedException("Invalid file name; paths not supported.");
        }

        // Return mapped file name
        return mappedFileName;
    }

    /// <summary>
    /// Gets a value indicating whether another request can use the System.Web.IHttpHandler instance.
    /// </summary>
    public bool IsReusable
    {
        get { return true; }
    }
}
