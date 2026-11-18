"""COM registration regressions; no Aspen process is launched."""
import unittest
from unittest.mock import patch

import pywintypes

from aspen_connection import create_aspen_document


class ConnectionTests(unittest.TestCase):
    def connect(self, versions, dispatcher):
        with patch("aspen_connection.registered_document_progids", return_value=versions), \
                patch("win32com.client.DispatchEx", dispatcher):
            return create_aspen_document()

    def test_versioned_install_without_generic_alias(self):
        with patch("win32com.client.DispatchEx", return_value=object()) as dispatch:
            expected = dispatch.return_value
            self.assertIs(self.connect(["Apwn.Document.41.0"], dispatch), expected)
            dispatch.assert_called_once_with("Apwn.Document.41.0")

    def test_generic_only_installation(self):
        with patch("win32com.client.DispatchEx", return_value=object()) as dispatch:
            self.connect([], dispatch)
            dispatch.assert_called_once_with("Apwn.Document")

    def test_stale_registration_can_fall_back(self):
        missing = pywintypes.com_error(-2147221164, "Class not registered", None, None)
        expected = object()
        with patch("win32com.client.DispatchEx", side_effect=[missing, expected]) as dispatch:
            self.assertIs(self.connect(["Apwn.Document.41.0", "Apwn.Document.40.0"], dispatch), expected)
            self.assertEqual([call.args[0] for call in dispatch.call_args_list],
                             ["Apwn.Document.41.0", "Apwn.Document.40.0"])

    def test_startup_error_is_not_hidden_by_version_fallback(self):
        failure = pywintypes.com_error(-2146959355, "Server execution failed", None, None)
        with patch("win32com.client.DispatchEx", side_effect=failure) as dispatch:
            with self.assertRaisesRegex(RuntimeError, "Apwn.Document.41.0"):
                self.connect(["Apwn.Document.41.0", "Apwn.Document.40.0"], dispatch)
            self.assertEqual(dispatch.call_count, 1)

    def test_missing_registration_has_actionable_error(self):
        missing = pywintypes.com_error(-2147221005, "Invalid class string", None, None)
        with patch("win32com.client.DispatchEx", side_effect=missing) as dispatch:
            with self.assertRaisesRegex(RuntimeError, "COM 注册"):
                self.connect([], dispatch)


if __name__ == "__main__":
    unittest.main()
