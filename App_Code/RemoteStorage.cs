// Restore to allow callers to list files (not required for PassWeb)
//#define ALLOW_LIST

// Remove to prevent the creation of backup files for each change
#define BACKUP_FILE

// Remove to allow the creation of new files
#define BLOCK_NEW

// Restore to enable simple support for Cross-Origin Resource Sharing
//#define SIMPLE_CORS

// Remove to allow requests to be handled as fast as possible
#define THROTTLE_REQUESTS

// Restore to allow bypass of BLOCK_NEW (necessary when testing)
//#define TEST_ALLOW_BYPASS_BLOCK_NEW

// Restore to allow list to include backup files (necessary when testing)
//#define TEST_ALLOW_LIST_INCLUDE_BACKUPS

// Restore to use a unique storage directory (preferred when testing)
//#define TEST_CREATE_UNIQUE_DIRECTORY

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;

/// <summary>
/// HTTP Handler that provides a simple REST API for PassWeb to create/read/update/delete data files on the server.
/// </summary>
public class RemoteStorage :
#if THROTTLE_REQUESTS
    IHttpAsyncHandler
#else
    IHttpHandler
#endif
{
#if TEST_CREATE_UNIQUE_DIRECTORY
    // Unique directory name
    private static readonly string UniqueDirectory = DateTime.UtcNow.Ticks.ToString();
#endif

#if SIMPLE_CORS
    // CORS header names
    private const string OriginHeaderName = "Origin";
    private const string AccessControlAllowOriginHeaderName = "Access-Control-Allow-Origin";
#endif

#if THROTTLE_REQUESTS
    // Time at which request throttling expires
    private static DateTime _throttleExpiration = DateTime.UtcNow;
    private static object _throttleExpirationLock = new object();

    /// <summary>
    /// Initiates an asynchronous call to the HTTP handler.
    /// </summary>
    /// <param name="context">An HttpContext object that provides references to intrinsic server objects (for example, Request, Response, Session, and Server) used to service HTTP requests.</param>
    /// <param name="cb">The AsyncCallback to call when the asynchronous method call is complete. If cb is null, the delegate is not called.</param>
    /// <param name="extraData">Any extra data needed to process the request.</param>
    /// <returns>An IAsyncResult that contains information about the status of the process.</returns>
    public IAsyncResult BeginProcessRequest(HttpContext context, AsyncCallback cb, object extraData)
    {
        // Throttle requests to slow enumeration of storage files
        TimeSpan waitDuration;
        lock (_throttleExpirationLock)
        {
            // Calculate wait duration
            var utcNow = DateTime.UtcNow;
            waitDuration = _throttleExpiration - utcNow;

            // Set new expiration time
            _throttleExpiration = utcNow.AddSeconds(1);
            if (0 < waitDuration.Ticks)
            {
                // Extend expiration by remaining time for current delay
                _throttleExpiration = _throttleExpiration.Add(waitDuration);
            }
            else
            {
                // Process request immediately
                waitDuration = TimeSpan.Zero;
            }
        }

        // Start a task to asynchronously process the request
        return Task
            .Delay(waitDuration)
            .ContinueWith(_ =>
            {
                ProcessRequest(context);
            }).ContinueWith(task =>
            {
                cb(task);
            });
    }

    /// <summary>
    /// Provides an asynchronous process End method when the process ends.
    /// </summary>
    /// <param name="result">An IAsyncResult that contains information about the status of the process.</param>
    public void EndProcessRequest(IAsyncResult result)
    {
        // Propagate any exceptions from the task
        ((Task)result).Wait();
    }
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
#if TEST_ALLOW_LIST_INCLUDE_BACKUPS
        var backupsParameter = (request.Params["backups"] != null);
#endif
#if TEST_ALLOW_BYPASS_BLOCK_NEW
        var bypassParameter = (request.Params["bypass"] != null);
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
                requestInputStream
#if TEST_ALLOW_BYPASS_BLOCK_NEW
                , bypassParameter
#endif
                );
        }
        else if ("get" == method)
        {
            if (null == mappedFileName)
            {
#if ALLOW_LIST
                ListFiles(
                    context.Server,
                    responseOutputStream
#if TEST_ALLOW_LIST_INCLUDE_BACKUPS
                    , backupsParameter
#endif
                    );
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
    /// <param name="includeBackups">True iff backups should be included.</param>
    private void ListFiles(
        HttpServerUtility serverUtility,
        Stream responseOutputStream
#if TEST_ALLOW_LIST_INCLUDE_BACKUPS
        , bool includeBackups
#endif
        )
    {
        using (var writer = new StreamWriter(responseOutputStream))
        {
            var directory = Path.GetDirectoryName(MapFileName(serverUtility, "placeholder"));
            var hiddenFiles = new Regex(@"\.\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d\d$");
            foreach (var file in Directory.EnumerateFiles(directory)
                     .Where(f =>
                     {
                         return
#if TEST_ALLOW_LIST_INCLUDE_BACKUPS
                            includeBackups ||
#endif
                            !hiddenFiles.IsMatch(f);
                     }))
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
    /// <param name="bypassParameter">True iff bypass of blocking should be allowed.</param>
    private void WriteFile(
        string mappedFileName,
#if BLOCK_NEW
        string mappedPreviousFileName,
#endif
        Stream requestInputStream
#if TEST_ALLOW_BYPASS_BLOCK_NEW
        , bool bypassParameter
#endif
        )
    {
#if BLOCK_NEW
        // Only write a file if it already exists OR the caller identifies a different file that exists (i.e., rename)
        if (!File.Exists(mappedFileName) &&
            ((null == mappedPreviousFileName) || !File.Exists(mappedPreviousFileName))
#if TEST_ALLOW_BYPASS_BLOCK_NEW
            && !bypassParameter
#endif
           )
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
#if TEST_CREATE_UNIQUE_DIRECTORY
        appDataDirectory = Path.Combine(appDataDirectory, UniqueDirectory);
#endif
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
